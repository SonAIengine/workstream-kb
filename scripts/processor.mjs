#!/usr/bin/env node

/**
 * Knowledge Base Processor (Layer 2) - v3
 * - inbox 전체를 수집 → 채팅방별 그룹화 → 노이즈 필터링
 * - Claude CLI 1회 호출로 하루 종합 업무 리포트 생성
 * - daily/{date}.md 저장
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
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  INBOX_DIR,
  DAILY_DIR,
  STATE_DIR,
  LOGS_DIR,
  INDEX_FILE,
  SYNC_STATE_FILE,
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

  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    const logFile = join(LOGS_DIR, `${ts.split('T')[0]}.log`);
    appendFileSync(logFile, line + '\n', 'utf-8');
  } catch {
    // 파일 기록 실패 시 무시
  }
}

// ─── Utility Functions ───────────────────────────────────────────────

function writeFileAtomic(filePath, content) {
  const tmpPath = filePath + '.tmp.' + Date.now();
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonSafe(filePath, defaultValue) {
  try {
    if (!existsSync(filePath)) return defaultValue;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    log('warn', `JSON 파싱 실패: ${filePath} - ${err.message}`);
    return defaultValue;
  }
}

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

function getClaudeEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

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

// ─── Core Functions ──────────────────────────────────────────────────

/**
 * inbox 디렉토리에서 모든 항목 수집
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
 * @returns {Map<string, {displayName, roomType, members: Set, messages: Array}>}
 */
function groupByRoom(items) {
  const rooms = new Map();

  for (const item of items) {
    let roomKey, displayName, roomType;

    if (item._sourceType === 'teams-chat') {
      roomKey = item.chatId || item.id;
      roomType = 'teams-chat';
      displayName = item.chatTopic || null;
    } else if (item._sourceType === 'teams-channel') {
      const teamName = item.teamName || 'unknown-team';
      const channelName = item.channelName || 'unknown-channel';
      roomKey = `${item.teamId || teamName}_${item.channelId || channelName}`;
      roomType = 'teams-channel';
      displayName = `${teamName} / ${channelName}`;
    } else if (item._sourceType === 'mail') {
      roomKey = 'mail';
      roomType = 'mail';
      displayName = '메일';
    } else {
      continue;
    }

    if (!rooms.has(roomKey)) {
      rooms.set(roomKey, {
        displayName,
        roomType,
        members: new Set(),
        messages: [],
      });
    }

    const room = rooms.get(roomKey);
    const fromName = item.from?.name || item.from?.emailAddress?.name || '';
    if (fromName) room.members.add(fromName);

    if (!room.displayName && item.chatTopic) {
      room.displayName = item.chatTopic;
    }

    room.messages.push(item);
  }

  // 2차 패스: displayName 미결정 채팅방 처리 (1:1 DM 판별)
  for (const [roomKey, room] of rooms) {
    if (room.displayName) continue;

    const members = [...room.members];
    const otherMembers = members.filter((m) => m !== MY_DISPLAY_NAME);

    if (otherMembers.length === 1) {
      room.displayName = `DM: ${otherMembers[0]}`;
    } else if (otherMembers.length > 1) {
      const namesSorted = otherMembers.sort().slice(0, 3).join(', ');
      room.displayName = namesSorted + (otherMembers.length > 3 ? ` 외 ${otherMembers.length - 3}명` : '');
    } else {
      room.displayName = members.join(', ') || roomKey.slice(0, 20);
    }
  }

  log('info', `${rooms.size}개 채팅방으로 그룹화 완료`);
  return rooms;
}

/**
 * 노이즈 사전 필터링
 * - 빈 content 제거
 * - 5자 이하 의미 없는 단답 제거
 * - 시스템 발신자 메일 제거
 */
function filterNoise(rooms) {
  const NOISE_PATTERNS = /^(네|넵|넹|ㅇㅇ|ㅋㅋ+|ㅎㅎ+|ㅇㅋ|ok|확인|감사|수고|👍|👌|🙏|ㄴㄴ|ㄱㄱ)$/i;
  const SYSTEM_SENDERS = /noreply|no-reply|microsoft|mailer-daemon|postmaster|notifications?@/i;

  let totalRemoved = 0;

  for (const [roomKey, room] of rooms) {
    const before = room.messages.length;

    room.messages = room.messages.filter((m) => {
      const content = m.content || m.bodyPreview || m.bodyMarkdown || m.subject || '';

      // 빈 content
      if (!content.trim()) return false;

      // 시스템 발신자 메일
      if (room.roomType === 'mail') {
        const fromEmail = m.from?.emailAddress?.address || '';
        if (SYSTEM_SENDERS.test(fromEmail)) return false;
      }

      // 5자 이하 의미 없는 단답
      if (content.trim().length <= 5 && NOISE_PATTERNS.test(content.trim())) return false;

      return true;
    });

    totalRemoved += before - room.messages.length;

    // 메시지 0건인 방 제거
    if (room.messages.length === 0) {
      rooms.delete(roomKey);
    }
  }

  log('info', `노이즈 필터링: ${totalRemoved}건 제거`);
  return rooms;
}

/**
 * Claude에게 보낼 입력 JSON 구성
 */
function buildReportInput(rooms, dateStr) {
  const stats = {
    'teams-chat': { rooms: 0, messages: 0 },
    'teams-channel': { rooms: 0, messages: 0 },
    'mail': { rooms: 0, messages: 0 },
  };

  const roomsData = [];

  for (const [, room] of rooms) {
    const type = room.roomType;
    if (stats[type]) {
      stats[type].rooms++;
      stats[type].messages += room.messages.length;
    }

    const messages = room.messages.map((m) => {
      const msg = {
        from: m.from?.name || m.from?.emailAddress?.name || 'Unknown',
        time: (m.createdDateTime || m.receivedDateTime || '').replace(/.*T/, '').replace(/\.\d+Z?$/, ''),
        content: (m.content || m.bodyPreview || m.bodyMarkdown || '').slice(0, 500),
      };

      // 메일은 subject, to, attachments 추가
      if (room.roomType === 'mail') {
        if (m.subject) msg.subject = m.subject;
        const toName = m.toRecipients?.[0]?.emailAddress?.name || m.to?.name || '';
        if (toName) msg.to = toName;
        if (m.attachments?.length > 0) {
          msg.attachments = m.attachments
            .filter((a) => a.savedPath && !a.skippedReason)
            .map((a) => a.name);
        }
      }

      return msg;
    });

    roomsData.push({
      name: room.displayName,
      type: room.roomType === 'teams-chat' && room.members.size <= 2 ? 'teams-chat-dm' : room.roomType,
      participants: [...room.members],
      messages,
    });
  }

  return {
    date: dateStr,
    myName: MY_DISPLAY_NAME,
    stats,
    rooms: roomsData,
  };
}

/**
 * Claude CLI 1회 호출로 일일 리포트 생성
 */
function generateDailyReport(rooms) {
  const today = new Date().toISOString().split('T')[0];
  const reportInput = buildReportInput(rooms, today);

  const totalMessages = Object.values(reportInput.stats).reduce((sum, s) => sum + s.messages, 0);
  if (totalMessages === 0) {
    log('info', '리포트 생성 건너뜀: 메시지 0건');
    return null;
  }

  const promptTemplate = readFileSync(
    join(PROMPTS_DIR, 'daily-report.md'),
    'utf-8'
  );

  const inputJson = JSON.stringify(reportInput, null, 2);

  const fullPrompt = promptTemplate
    .replace('{INPUT}', inputJson)
    .replace('{MY_NAME}', MY_DISPLAY_NAME)
    .replace(/{DATE}/g, today);

  log('info', `일일 리포트 생성 중... (${reportInput.rooms.length}개 방, ${totalMessages}건 메시지)`);

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

    const reportContent = extractMarkdownFromResponse(result);

    ensureDir(DAILY_DIR);
    const reportPath = join(DAILY_DIR, `${today}.md`);
    writeFileAtomic(reportPath, reportContent);
    log('info', `일일 리포트 저장: daily/${today}.md`);

    return { date: today, path: `daily/${today}.md`, totalMessages };
  } catch (err) {
    log('error', `Claude CLI 호출 실패: ${err.message}`);
    return null;
  }
}

/**
 * index.json에 daily 엔트리 추가
 */
function updateIndex(entry) {
  if (!entry) return;

  const index = readJsonSafe(INDEX_FILE, {
    version: 3,
    lastUpdated: null,
    entries: [],
  });

  // v2 → v3 마이그레이션
  if (index.version < 3) {
    index.version = 3;
  }

  // 같은 날짜 엔트리 교체
  const existingIdx = index.entries.findIndex((e) => e.date === entry.date && e.type === 'daily-report');
  const newEntry = {
    id: `daily/${entry.date}`,
    type: 'daily-report',
    title: `업무 일일 리포트 - ${entry.date}`,
    date: entry.date,
    messageCount: entry.totalMessages,
    path: entry.path,
  };

  if (existingIdx >= 0) {
    index.entries[existingIdx] = newEntry;
  } else {
    index.entries.push(newEntry);
  }

  index.lastUpdated = new Date().toISOString();
  writeFileAtomic(INDEX_FILE, JSON.stringify(index, null, 2));
  log('info', `index.json 업데이트: daily/${entry.date} (총 ${index.entries.length}개)`);
}

/**
 * 메일 첨부파일을 daily/attachments/{date}/ 로 복사
 * @returns {number} 복사된 파일 수
 */
function copyAttachments(items, dateStr) {
  const attachDir = join(DAILY_DIR, 'attachments', dateStr);
  let copied = 0;

  for (const item of items) {
    if (item._sourceType !== 'mail' || !item.attachments?.length) continue;

    for (const att of item.attachments) {
      if (!att.savedPath || att.skippedReason) continue;
      if (!existsSync(att.savedPath)) continue;

      ensureDir(attachDir);
      const destPath = join(attachDir, basename(att.savedPath));
      try {
        copyFileSync(att.savedPath, destPath);
        copied++;
      } catch (err) {
        log('warn', `첨부파일 복사 실패: ${att.name} - ${err.message}`);
      }
    }
  }

  if (copied > 0) {
    log('info', `첨부파일 ${copied}개 복사 → daily/attachments/${dateStr}/`);
  }
  return copied;
}

/**
 * 처리 완료된 inbox 파일 삭제
 */
function cleanupInbox(items) {
  let cleaned = 0;
  for (const item of items) {
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
  // inbox/mail/attachments/ 디렉토리 정리
  const inboxAttachDir = join(INBOX_DIR, 'mail', 'attachments');
  if (existsSync(inboxAttachDir)) {
    try {
      rmSync(inboxAttachDir, { recursive: true });
      log('info', 'inbox/mail/attachments/ 정리 완료');
    } catch (err) {
      log('warn', `inbox 첨부파일 디렉토리 삭제 실패: ${err.message}`);
    }
  }

  log('info', `inbox 정리 완료: ${cleaned}개 파일 삭제`);
}

/**
 * sync-state.json 업데이트
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
  log('info', 'Processor v3 started');
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
  let rooms = groupByRoom(items);

  // 3. 노이즈 필터링
  rooms = filterNoise(rooms);

  if (rooms.size === 0) {
    log('info', '필터링 후 처리할 채팅방이 없습니다. 종료합니다.');
    process.exit(0);
  }

  // 4. Claude CLI 1회 호출 → 일일 리포트 생성
  let reportResult;
  try {
    reportResult = generateDailyReport(rooms);
  } catch (err) {
    log('error', `리포트 생성 실패: ${err.message}`);
  }

  // 5. 첨부파일 복사
  const today = new Date().toISOString().split('T')[0];
  try {
    copyAttachments(items, today);
  } catch (err) {
    log('error', `첨부파일 복사 실패: ${err.message}`);
  }

  // 6. index.json 업데이트
  try {
    updateIndex(reportResult);
  } catch (err) {
    log('error', `index.json 업데이트 실패: ${err.message}`);
  }

  // 7. inbox 정리 (리포트 성공 시에만)
  if (reportResult) {
    try {
      cleanupInbox(items);
    } catch (err) {
      log('error', `inbox 정리 실패: ${err.message}`);
    }
  } else {
    log('warn', '리포트 생성 실패 — inbox 파일을 보존합니다');
  }

  // 7. sync-state.json 업데이트
  try {
    updateSyncState(items.length);
  } catch (err) {
    log('error', `sync-state 업데이트 실패: ${err.message}`);
  }

  // 8. 최종 요약
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(
    'info',
    `Processor 완료: ${rooms.size}개 방, ${items.length}개 메시지 처리, ${elapsed}초 소요`
  );
}

main().catch((err) => {
  log('error', `치명적 오류: ${err.message}`);
  process.exit(1);
});
