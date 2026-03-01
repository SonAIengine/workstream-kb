#!/usr/bin/env node

/**
 * Knowledge Base Processor (Layer 2) - v2
 * - inbox의 메일/Teams 항목을 수집
 * - 채팅방(room)별 + 날짜별로 그룹화
 * - Claude CLI로 방별 일일 요약 생성
 * - rooms/{type}/{slug}/{date}.md 저장
 * - 전체 일일 다이제스트 생성
 *
 * 매일 07:00 launchd로 실행
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  INBOX_DIR,
  ROOMS_DIR,
  DAILY_DIR,
  STATE_DIR,
  LOGS_DIR,
  INDEX_FILE,
  SYNC_STATE_FILE,
  ROOM_MAP_FILE,
  CLAUDE_CLI_PATH as CLAUDE_CLI,
  CLAUDE_TIMEOUT_MS,
  MY_DISPLAY_NAME,
} from './lib/config.mjs';

const PROMPTS_DIR = join(dirname(new URL(import.meta.url).pathname), 'prompts');

// ─── Logger (standalone, lib/ 의존 없이 독립 실행 가능) ──────────────

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] [processor] ${msg}`;

  const consoleFn =
    level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : console.log;
  consoleFn(line);

  // 파일에도 기록
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    const logFile = join(LOGS_DIR, `${ts.split('T')[0]}.log`);
    appendFileSync(logFile, line + '\n', 'utf-8');
  } catch {
    // 파일 기록 실패 시 무시 (콘솔 출력은 이미 완료)
  }
}

// ─── Utility Functions ───────────────────────────────────────────────

/**
 * 원자적 파일 쓰기: temp 파일에 쓴 후 rename
 */
function writeFileAtomic(filePath, content) {
  const tmpPath = filePath + '.tmp.' + Date.now();
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * 디렉토리가 없으면 재귀적으로 생성
 */
function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * JSON 파일을 안전하게 읽기 (파싱 실패 시 기본값 반환)
 */
function readJsonSafe(filePath, defaultValue) {
  try {
    if (!existsSync(filePath)) return defaultValue;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    log('warn', `JSON 파싱 실패: ${filePath} - ${err.message}`);
    return defaultValue;
  }
}

/**
 * Claude 응답에서 markdown 추출 (--output-format json wrapper 대응)
 */
function extractMarkdownFromResponse(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.result && typeof parsed.result === 'string') {
      return parsed.result;
    }
  } catch {
    // JSON이 아니면 그대로 markdown
  }
  return text;
}

/**
 * Claude CLI 실행용 환경변수 (중첩 세션 방지 해제)
 */
function getClaudeEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

/**
 * 디렉토리명용 slug 생성 (한글/영문/숫자/하이픈만 허용)
 */
function sanitizeSlug(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[()（）\[\]]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unknown';
}

// ─── Room Map (chatId → slug 캐시) ──────────────────────────────────

function loadRoomMap() {
  return readJsonSafe(ROOM_MAP_FILE, {});
}

function saveRoomMap(roomMap) {
  ensureDir(dirname(ROOM_MAP_FILE));
  writeFileAtomic(ROOM_MAP_FILE, JSON.stringify(roomMap, null, 2));
}

// ─── Core Functions ──────────────────────────────────────────────────

/**
 * inbox 디렉토리에서 모든 항목 수집
 * inbox/mail/, inbox/teams-chat/, inbox/teams-channel/ 하위의 .json 파일
 */
function collectInboxItems() {
  const items = [];
  const subdirs = ['mail', 'teams-chat', 'teams-channel'];

  for (const subdir of subdirs) {
    const dirPath = join(INBOX_DIR, subdir);
    if (!existsSync(dirPath)) continue;

    const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const filePath = join(dirPath, file);
        const content = readFileSync(filePath, 'utf-8');
        const item = JSON.parse(content);
        // 소스 정보 추가 (나중에 cleanup용)
        item._sourceFile = filePath;
        item._sourceType = subdir;
        items.push(item);
      } catch (err) {
        log('warn', `파일 읽기 실패: ${join(subdir, file)} - ${err.message}`);
      }
    }
  }

  log('info', `Found ${items.length} items in inbox`);
  return items;
}

/**
 * 아이템들을 룸별로 그룹화
 * @returns {Map<string, {slug, displayName, roomType, dateGroups: Map<string, Array>}>}
 */
function groupByRoom(items) {
  const rooms = new Map();
  const roomMap = loadRoomMap();

  for (const item of items) {
    let roomKey, slug, displayName, roomType;

    if (item._sourceType === 'teams-chat') {
      roomKey = item.chatId || item.id;
      roomType = 'teams-chat';

      // 캐시된 slug가 있으면 사용
      if (roomMap[roomKey]) {
        slug = roomMap[roomKey].slug;
        displayName = roomMap[roomKey].displayName;
      } else if (item.chatTopic) {
        // 그룹 채팅 (topic 있음)
        slug = sanitizeSlug(item.chatTopic);
        displayName = item.chatTopic;
      } else {
        // 1:1 또는 topic 없는 채팅 — 나중에 멤버 분석으로 결정
        slug = null; // 임시, 그룹 완성 후 결정
        displayName = null;
      }
    } else if (item._sourceType === 'teams-channel') {
      const teamName = item.teamName || 'unknown-team';
      const channelName = item.channelName || 'unknown-channel';
      roomKey = `${item.teamId || teamName}_${item.channelId || channelName}`;
      roomType = 'teams-channel';
      slug = sanitizeSlug(`${teamName}_${channelName}`);
      displayName = `${teamName} / ${channelName}`;
    } else if (item._sourceType === 'mail') {
      roomKey = 'mail';
      roomType = 'mail';
      slug = 'mail';
      displayName = '메일';
    } else {
      continue;
    }

    if (!rooms.has(roomKey)) {
      rooms.set(roomKey, {
        slug,
        displayName,
        roomType,
        members: new Set(),
        dateGroups: new Map(),
      });
    }

    const room = rooms.get(roomKey);
    // 멤버 추적
    const fromName = item.from?.name || item.from?.emailAddress?.name || '';
    if (fromName) room.members.add(fromName);

    // slug/displayName 업데이트 (캐시 miss 후 topic 있는 메시지 발견 시)
    if (!room.slug && item.chatTopic) {
      room.slug = sanitizeSlug(item.chatTopic);
      room.displayName = item.chatTopic;
    }

    // 날짜별 그룹화
    const dateStr = (item.receivedDateTime || item.createdDateTime || new Date().toISOString()).split('T')[0];
    if (!room.dateGroups.has(dateStr)) {
      room.dateGroups.set(dateStr, []);
    }
    room.dateGroups.get(dateStr).push(item);
  }

  // 2차 패스: slug 미결정 채팅방 처리 (1:1 DM 판별)
  for (const [roomKey, room] of rooms) {
    if (room.slug) continue;

    const members = [...room.members];
    const otherMembers = members.filter((m) => m !== MY_DISPLAY_NAME);

    if (otherMembers.length === 1) {
      // 1:1 DM
      room.slug = `dm-${sanitizeSlug(otherMembers[0])}`;
      room.displayName = `DM: ${otherMembers[0]}`;
    } else if (otherMembers.length > 1) {
      // topic 없는 그룹 채팅
      const namesSorted = otherMembers.sort().slice(0, 3).join(', ');
      room.slug = sanitizeSlug(otherMembers.sort().slice(0, 3).join('-'));
      room.displayName = namesSorted + (otherMembers.length > 3 ? ` 외 ${otherMembers.length - 3}명` : '');
    } else {
      // 본인만 있는 경우 (봇 등)
      room.slug = sanitizeSlug(members.join('-') || roomKey.slice(0, 20));
      room.displayName = members.join(', ') || roomKey.slice(0, 20);
    }
  }

  // roomMap 캐시 업데이트
  let mapUpdated = false;
  for (const [roomKey, room] of rooms) {
    if (!roomMap[roomKey] || roomMap[roomKey].slug !== room.slug) {
      roomMap[roomKey] = { slug: room.slug, displayName: room.displayName };
      mapUpdated = true;
    }
  }
  if (mapUpdated) {
    saveRoomMap(roomMap);
    log('info', `room-map.json 업데이트: ${Object.keys(roomMap).length}개 방`);
  }

  log('info', `${rooms.size}개 채팅방으로 그룹화 완료`);
  return rooms;
}

/**
 * 요약 호출 여부 판단
 * 메시지 3건 미만이고 모든 메시지가 짧으면(20자 미만) 건너뜀
 */
function shouldSummarize(messages) {
  if (messages.length >= 3) return true;

  const hasSubstantialContent = messages.some((m) => {
    const content = m.content || m.bodyPreview || m.bodyMarkdown || '';
    return content.length >= 20;
  });

  return hasSubstantialContent;
}

/**
 * Claude CLI를 호출하여 방별 일일 요약 생성
 */
function summarizeRoomDay(room, dateStr, messages) {
  const promptTemplate = readFileSync(
    join(PROMPTS_DIR, 'room-summary.md'),
    'utf-8'
  );

  // 프롬프트용 메시지 정리
  const cleanMessages = messages.map((m) => ({
    from: m.from?.name || m.from?.emailAddress?.name || 'Unknown',
    time: m.createdDateTime || m.receivedDateTime || '',
    content: (m.content || m.bodyPreview || m.bodyMarkdown || m.subject || '').slice(0, 500),
    subject: m.subject || '',
  }));

  const participants = [...room.members].join(', ');

  const inputData = JSON.stringify({
    roomName: room.displayName,
    roomType: room.roomType,
    date: dateStr,
    messageCount: messages.length,
    participants,
    messages: cleanMessages,
  }, null, 2);

  const fullPrompt = promptTemplate
    .replace('{INPUT}', inputData)
    .replace('{ROOM_NAME}', room.displayName)
    .replace('{ROOM_TYPE}', room.roomType)
    .replace('{DATE}', dateStr)
    .replace('{MESSAGE_COUNT}', String(messages.length))
    .replace('{PARTICIPANTS}', participants);

  try {
    const result = execFileSync(
      CLAUDE_CLI,
      [
        '-p',
        fullPrompt,
        '--output-format',
        'json',
        '--no-session-persistence',
        '--dangerously-skip-permissions',
      ],
      {
        timeout: CLAUDE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        env: getClaudeEnv(),
      }
    );

    return extractMarkdownFromResponse(result);
  } catch (err) {
    log('error', `Claude CLI 호출 실패 (${room.displayName}/${dateStr}): ${err.message}`);
    return null;
  }
}

/**
 * index.json에 새 항목 추가 (room-day 단위)
 */
function updateIndex(entries) {
  const index = readJsonSafe(INDEX_FILE, {
    version: 2,
    lastUpdated: null,
    entries: [],
  });

  // v1 → v2 마이그레이션: 기존 entries 유지하되 version 업데이트
  if (index.version === 1) {
    index.version = 2;
  }

  // 기존 path 기준으로 중복 방지
  const existingPaths = new Set(index.entries.map((e) => e.path));
  const newEntries = entries.filter((e) => !existingPaths.has(e.path));

  if (newEntries.length === 0) {
    log('info', 'index.json: 추가할 새 항목 없음');
    return;
  }

  index.entries.push(...newEntries);
  index.lastUpdated = new Date().toISOString();

  writeFileAtomic(INDEX_FILE, JSON.stringify(index, null, 2));
  log('info', `index.json 업데이트: ${newEntries.length}개 항목 추가 (총 ${index.entries.length}개)`);
}

/**
 * 일일 다이제스트 생성
 * @param {Array} roomSummaries - [{roomName, roomType, dateStr, path, messageCount, content}]
 */
function generateDailyDigest(roomSummaries) {
  if (roomSummaries.length === 0) {
    log('info', '다이제스트 생성 건너뜀: 요약된 방 없음');
    return;
  }

  const promptTemplate = readFileSync(
    join(PROMPTS_DIR, 'daily-digest.md'),
    'utf-8'
  );

  const inputData = JSON.stringify(
    roomSummaries.map((s) => ({
      roomName: s.roomName,
      roomType: s.roomType,
      messageCount: s.messageCount,
      summary: s.content,
    })),
    null,
    2
  );

  const fullPrompt = promptTemplate.replace('{INPUT}', inputData);

  log('info', '일일 다이제스트 생성 중...');

  try {
    const result = execFileSync(
      CLAUDE_CLI,
      [
        '-p',
        fullPrompt,
        '--output-format',
        'json',
        '--no-session-persistence',
        '--dangerously-skip-permissions',
      ],
      {
        timeout: CLAUDE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        env: getClaudeEnv(),
      }
    );

    const digestContent = extractMarkdownFromResponse(result);

    const today = new Date().toISOString().split('T')[0];
    ensureDir(DAILY_DIR);
    const digestPath = join(DAILY_DIR, `${today}.md`);
    writeFileAtomic(digestPath, digestContent);
    log('info', `일일 다이제스트 저장: daily/${today}.md`);
  } catch (err) {
    log('error', `다이제스트 생성 실패: ${err.message}`);
  }
}

/**
 * 처리 완료된 inbox 파일 삭제
 */
function cleanupInbox(processedItems) {
  let cleaned = 0;
  for (const item of processedItems) {
    const sourceFile = item._sourceFile;
    if (sourceFile && existsSync(sourceFile)) {
      try {
        unlinkSync(sourceFile);
        cleaned++;
      } catch (err) {
        log('warn', `inbox 파일 삭제 실패: ${sourceFile} - ${err.message}`);
      }
    }
  }
  log('info', `inbox 정리 완료: ${cleaned}개 파일 삭제`);
}

/**
 * sync-state.json의 processor 섹션 업데이트
 */
function updateSyncState(processedCount) {
  const state = readJsonSafe(SYNC_STATE_FILE, {});
  state.processor = {
    lastRun: new Date().toISOString(),
    totalProcessed: (state.processor?.totalProcessed || 0) + processedCount,
  };
  writeFileAtomic(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
  log('info', `sync-state.json 업데이트: totalProcessed=${state.processor.totalProcessed}`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  log('info', 'Processor v2 started');
  const startTime = Date.now();

  // 1. inbox 항목 수집
  let items;
  try {
    items = collectInboxItems();
  } catch (err) {
    log('error', `inbox 수집 실패: ${err.message}`);
    process.exit(1);
  }

  if (items.length === 0) {
    log('info', 'inbox에 처리할 항목이 없습니다. 종료합니다.');
    process.exit(0);
  }

  // 2. 채팅방별 그룹화
  const rooms = groupByRoom(items);

  // 3. 각 room-day별 요약 생성
  const indexEntries = [];
  const roomSummaries = [];
  const processedItems = [];
  let summarizedCount = 0;
  let skippedCount = 0;

  for (const [roomKey, room] of rooms) {
    for (const [dateStr, messages] of room.dateGroups) {
      // 요약 필요 여부 판단
      if (!shouldSummarize(messages)) {
        log('info', `건너뜀: ${room.displayName}/${dateStr} (${messages.length}건, 내용 부족)`);
        skippedCount++;
        processedItems.push(...messages);
        continue;
      }

      log('info', `요약 중: ${room.displayName}/${dateStr} (${messages.length}건)`);

      const summaryContent = summarizeRoomDay(room, dateStr, messages);
      if (!summaryContent) {
        log('warn', `요약 실패: ${room.displayName}/${dateStr}`);
        continue;
      }

      // rooms/{type}/{slug}/{date}.md 저장
      const roomDir = join(ROOMS_DIR, room.roomType, room.slug);
      ensureDir(roomDir);
      const filePath = join(roomDir, `${dateStr}.md`);

      // 기존 파일이 있으면 병합 (같은 날 여러 번 실행 대응)
      if (existsSync(filePath)) {
        const existing = readFileSync(filePath, 'utf-8');
        // 기존 내용을 덮어쓰기 (같은 날의 최신 요약으로 대체)
        log('info', `기존 파일 덮어쓰기: ${room.roomType}/${room.slug}/${dateStr}.md`);
      }

      writeFileAtomic(filePath, summaryContent);

      const relativePath = `rooms/${room.roomType}/${room.slug}/${dateStr}.md`;
      log('info', `저장: ${relativePath}`);

      // index 엔트리
      indexEntries.push({
        id: `${room.slug}/${dateStr}`,
        type: room.roomType,
        room: room.displayName,
        title: `${room.displayName} - ${dateStr}`,
        date: dateStr,
        messageCount: messages.length,
        path: relativePath,
      });

      // 다이제스트용 요약 수집
      roomSummaries.push({
        roomName: room.displayName,
        roomType: room.roomType,
        dateStr,
        messageCount: messages.length,
        content: summaryContent,
        path: relativePath,
      });

      processedItems.push(...messages);
      summarizedCount++;
    }
  }

  if (summarizedCount === 0 && skippedCount === 0) {
    log('warn', '처리된 항목이 없습니다. 종료합니다.');
    process.exit(1);
  }

  // 4. index.json 업데이트
  try {
    updateIndex(indexEntries);
  } catch (err) {
    log('error', `index.json 업데이트 실패: ${err.message}`);
  }

  // 5. 일일 다이제스트 생성
  try {
    generateDailyDigest(roomSummaries);
  } catch (err) {
    log('error', `일일 다이제스트 생성 실패: ${err.message}`);
  }

  // 6. inbox 정리
  try {
    cleanupInbox(processedItems);
  } catch (err) {
    log('error', `inbox 정리 실패: ${err.message}`);
  }

  // 7. sync-state.json 업데이트
  try {
    updateSyncState(processedItems.length);
  } catch (err) {
    log('error', `sync-state 업데이트 실패: ${err.message}`);
  }

  // 8. 최종 요약
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(
    'info',
    `Processor 완료: ${summarizedCount}개 방 요약, ${skippedCount}개 건너뜀, ${processedItems.length}/${items.length}개 메시지 처리, ${elapsed}초 소요`
  );
}

main().catch((err) => {
  log('error', `치명적 오류: ${err.message}`);
  process.exit(1);
});
