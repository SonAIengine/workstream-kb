#!/usr/bin/env node

/**
 * Knowledge Base Processor (Layer 2)
 * - inbox의 메일/Teams 항목을 수집
 * - Claude CLI로 프로젝트 분류 및 요약
 * - 프로젝트별 마크다운 저장
 * - 일일 다이제스트 생성
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
  PROJECTS_DIR,
  DAILY_DIR,
  STATE_DIR,
  LOGS_DIR,
  INDEX_FILE,
  SYNC_STATE_FILE,
  CLAUDE_CLI_PATH as CLAUDE_CLI,
  BATCH_SIZE,
  CLAUDE_TIMEOUT_MS,
  PROJECT_KEYWORDS_FILE,
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
 * 파일명에 사용할 수 없는 문자 제거 및 길이 제한
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

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
 * Claude 응답에서 JSON 배열 추출 (non-JSON wrapper 대응)
 */
function extractJsonFromResponse(text) {
  // 먼저 전체가 유효한 JSON인지 확인
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    // JSON 블록을 찾아서 추출 시도
  }

  // ```json ... ``` 블록 추출
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // 다음 방법 시도
    }
  }

  // [ ... ] 배열 패턴 추출
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // 다음 방법 시도
    }
  }

  // { ... } 객체 패턴 추출
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      // 추출 실패
    }
  }

  return null;
}

/**
 * Claude CLI 실행용 환경변수 (중첩 세션 방지 해제)
 */
function getClaudeEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
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
 * Claude CLI를 사용하여 항목들을 프로젝트별로 분류
 * @param {Array} items - 분류할 항목 배열
 * @returns {Array} 분류 결과 배열
 */
function classifyItems(items) {
  let promptTemplate = readFileSync(
    join(PROMPTS_DIR, 'classify.md'),
    'utf-8'
  );

  // project-keywords.json에서 동적으로 프로젝트 목록 주입
  if (promptTemplate.includes('{PROJECTS}')) {
    const keywords = readJsonSafe(PROJECT_KEYWORDS_FILE, {});
    const projectList = Object.entries(keywords)
      .map(([name, cfg]) => `- ${name}: 키워드 [${cfg.keywords?.join(', ') || ''}]`)
      .join('\n');
    promptTemplate = promptTemplate.replace('{PROJECTS}', projectList + '\n- _general: 위 프로젝트에 해당하지 않는 일반 항목');
  }

  // 분류에 필요한 최소 필드만 추출 (프롬프트 크기 제한)
  const cleanItems = items.map((item) => ({
    id: item.id,
    type: item._sourceType || item.type,
    subject: item.subject || item.chatTopic || '',
    from: item.from?.name || item.from?.emailAddress?.name || '',
    fromEmail: item.from?.email || item.from?.emailAddress?.address || '',
    bodyPreview: (item.bodyPreview || item.bodyMarkdown || item.content || '').slice(0, 300),
    importance: item.importance || 'normal',
    date: item.receivedDateTime || item.createdDateTime || '',
  }));
  const fullPrompt = promptTemplate.replace(
    '{INPUT}',
    JSON.stringify(cleanItems, null, 2)
  );

  log('info', `Claude CLI로 ${items.length}개 항목 분류 요청`);

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

    // Claude CLI의 --output-format json 응답 파싱
    let parsed = extractJsonFromResponse(result);

    if (!parsed) {
      log('error', 'Claude 응답에서 JSON 추출 실패');
      log('debug', `Raw response (처음 500자): ${result.slice(0, 500)}`);
      return [];
    }

    // --output-format json은 { result: "..." } 형태일 수 있음
    if (parsed.result && typeof parsed.result === 'string') {
      parsed = extractJsonFromResponse(parsed.result);
    }

    if (!Array.isArray(parsed)) {
      log('warn', '분류 결과가 배열이 아님, 단일 객체를 배열로 변환');
      parsed = [parsed];
    }

    log('info', `분류 완료: ${parsed.length}개 항목`);
    return parsed;
  } catch (err) {
    log('error', `Claude CLI 호출 실패: ${err.message}`);
    return [];
  }
}

/**
 * 분류 결과를 마크다운 문서로 변환
 * @param {Object} item - 원본 inbox 항목
 * @param {Object} classification - 분류 결과
 * @returns {string} 마크다운 문서
 */
function generateMarkdown(item, classification) {
  const fromName = item.from?.name || item.from?.emailAddress?.name || 'Unknown';
  const fromEmail = item.from?.emailAddress?.address || item.from?.email || '';
  const itemDate =
    item.receivedDateTime || item.createdDateTime || new Date().toISOString();
  const tags = (classification.tags || []).map((t) => `"${t}"`).join(', ');

  // 본문: bodyMarkdown 우선, 없으면 content, body 순
  const body = item.bodyMarkdown || item.content || item.body?.content || '(본문 없음)';

  // 첨부파일 목록
  let attachmentsSection = '';
  if (item.attachments && item.attachments.length > 0) {
    const attachmentLines = item.attachments
      .map((a) => `- ${a.name || a.filename || 'unnamed'}`)
      .join('\n');
    attachmentsSection = `\n## 첨부파일\n${attachmentLines}\n`;
  }

  const markdown = `---
id: "${item.id || classification.id}"
type: "${item._sourceType || 'unknown'}"
project: "${classification.project}"
from: "${fromName}"
date: "${itemDate}"
tags: [${tags}]
importance: "${classification.importance || 'medium'}"
---
# ${classification.title}

## 요약
${classification.summary}

## 원문
${body}
${attachmentsSection}`;

  return markdown;
}

/**
 * 마크다운 문서를 프로젝트 디렉토리에 저장
 * @param {string} markdown - 저장할 마크다운 내용
 * @param {Object} classification - 분류 결과
 * @param {Object} item - 원본 항목 (날짜 추출용)
 * @returns {string} 저장된 파일의 상대 경로
 */
function saveToProject(markdown, classification, item) {
  const itemDate =
    item.receivedDateTime || item.createdDateTime || new Date().toISOString();
  const dateObj = new Date(itemDate);
  const yearMonth = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
  const dateStr = itemDate.split('T')[0]; // YYYY-MM-DD

  const projectName = classification.project || '_general';
  const sanitizedTitle = sanitizeFilename(classification.title || 'untitled');
  const fileName = `${dateStr}-${sanitizedTitle}.md`;

  const projectDir = join(PROJECTS_DIR, projectName, yearMonth);
  ensureDir(projectDir);

  const filePath = join(projectDir, fileName);
  writeFileAtomic(filePath, markdown);

  // KB_ROOT 기준 상대 경로 반환
  const relativePath = `projects/${projectName}/${yearMonth}/${fileName}`;
  log('info', `저장: ${relativePath}`);
  return relativePath;
}

/**
 * index.json에 새 항목 추가
 * @param {Array} entries - 추가할 엔트리 배열 [{ id, type, project, title, summary, tags, date, path }]
 */
function updateIndex(entries) {
  const index = readJsonSafe(INDEX_FILE, {
    version: 1,
    lastUpdated: null,
    entries: [],
  });

  // 기존 ID 목록으로 중복 방지
  const existingIds = new Set(index.entries.map((e) => e.id));
  const newEntries = entries.filter((e) => !existingIds.has(e.id));

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
 * @param {Array} classifiedItems - 분류된 항목 배열
 */
function generateDailyDigest(classifiedItems) {
  const promptTemplate = readFileSync(
    join(PROMPTS_DIR, 'daily-digest.md'),
    'utf-8'
  );

  const fullPrompt = promptTemplate.replace(
    '{INPUT}',
    JSON.stringify(classifiedItems, null, 2)
  );

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

    // 다이제스트는 마크다운 텍스트, JSON wrapper에서 추출
    let digestContent = result;
    try {
      const parsed = JSON.parse(result);
      // --output-format json 응답 구조: { result: "..." }
      if (parsed.result) {
        digestContent = parsed.result;
      }
    } catch {
      // 이미 마크다운 텍스트일 수 있음
    }

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
 * @param {Array} processedItems - 처리된 원본 항목 배열
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
 * @param {number} processedCount - 이번에 처리한 항목 수
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
  log('info', 'Processor started');
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

  // 2. 배치 단위로 분류
  let allClassified = [];
  try {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(items.length / BATCH_SIZE);
      log('info', `분류 배치 ${batchNum}/${totalBatches} (${batch.length}개 항목)`);

      const classified = classifyItems(batch);
      allClassified.push(...classified);
    }
  } catch (err) {
    log('error', `분류 단계 실패: ${err.message}`);
    // 분류된 것까지만 계속 처리
  }

  if (allClassified.length === 0) {
    log('warn', '분류된 항목이 없습니다. 종료합니다.');
    process.exit(1);
  }

  // 3. 마크다운 생성 및 프로젝트에 저장
  const indexEntries = [];
  const processedItems = [];

  for (const classification of allClassified) {
    // 원본 항목 매칭 (id 기반)
    const originalItem = items.find((item) => item.id === classification.id);
    if (!originalItem) {
      log('warn', `원본 항목을 찾을 수 없음: id=${classification.id}`);
      continue;
    }

    try {
      const markdown = generateMarkdown(originalItem, classification);
      const savedPath = saveToProject(markdown, classification, originalItem);

      // index 엔트리 생성
      indexEntries.push({
        id: classification.id,
        type: originalItem._sourceType || 'unknown',
        project: classification.project,
        title: classification.title,
        summary: classification.summary,
        tags: classification.tags || [],
        date:
          originalItem.receivedDateTime ||
          originalItem.createdDateTime ||
          new Date().toISOString(),
        path: savedPath,
      });

      processedItems.push(originalItem);
    } catch (err) {
      log('error', `항목 처리 실패 (id=${classification.id}): ${err.message}`);
    }
  }

  // 4. index.json 업데이트
  try {
    updateIndex(indexEntries);
  } catch (err) {
    log('error', `index.json 업데이트 실패: ${err.message}`);
  }

  // 5. 일일 다이제스트 생성
  try {
    generateDailyDigest(allClassified);
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
    `Processor 완료: ${processedItems.length}/${items.length}개 처리, ${elapsed}초 소요`
  );
}

main().catch((err) => {
  log('error', `치명적 오류: ${err.message}`);
  process.exit(1);
});
