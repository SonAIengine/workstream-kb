#!/usr/bin/env node

/**
 * Archiver - v3
 * ARCHIVE_AFTER_MONTHS 이전의 데이터를 archive/ 디렉토리로 이동
 *
 * 대상:
 *   - daily/{YYYY-MM-DD}.md → archive/daily/{YYYY-MM-DD}.md
 *
 * index.json의 path도 함께 업데이트
 */

import { readdirSync, renameSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAILY_DIR, ARCHIVE_DIR, INDEX_FILE, ARCHIVE_AFTER_MONTHS } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';

const logger = createLogger('Archiver');

function getCutoffMonth() {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - ARCHIVE_AFTER_MONTHS, 1);
  const yyyy = cutoff.getFullYear();
  const mm = String(cutoff.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function archiveDaily(cutoffMonth) {
  if (!existsSync(DAILY_DIR)) return 0;

  let movedCount = 0;
  const files = readdirSync(DAILY_DIR)
    .filter((f) => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

  const archiveDailyDir = join(ARCHIVE_DIR, 'daily');

  for (const file of files) {
    const fileMonth = file.slice(0, 7);
    if (fileMonth >= cutoffMonth) continue;

    ensureDir(archiveDailyDir);

    const src = join(DAILY_DIR, file);
    const dst = join(archiveDailyDir, file);

    try {
      renameSync(src, dst);
      movedCount++;
      logger.info(`아카이브: daily/${file}`);
    } catch (err) {
      logger.error(`아카이브 실패 (${src}): ${err.message}`);
    }
  }

  return movedCount;
}

function updateIndex(cutoffMonth) {
  if (!existsSync(INDEX_FILE)) return 0;

  let index;
  try {
    index = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
  } catch (err) {
    logger.error(`index.json 읽기 실패: ${err.message}`);
    return 0;
  }

  let updatedCount = 0;

  for (const entry of index.entries || []) {
    if (!entry.path) continue;

    const dailyMatch = entry.path.match(/^daily\/(\d{4}-\d{2})-\d{2}\.md$/);
    if (dailyMatch) {
      const month = dailyMatch[1];
      if (month < cutoffMonth) {
        entry.path = entry.path.replace(/^daily\//, 'archive/daily/');
        updatedCount++;
      }
    }
  }

  if (updatedCount > 0) {
    index.lastUpdated = new Date().toISOString();
    const tmpPath = INDEX_FILE + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
    renameSync(tmpPath, INDEX_FILE);
    logger.info(`index.json 업데이트: ${updatedCount}건`);
  }

  return updatedCount;
}

// ─── Main ────────────────────────────────────────────────────────

function main() {
  const cutoffMonth = getCutoffMonth();
  logger.info(`아카이브 시작 (기준: ${cutoffMonth} 이전)`);

  if (ARCHIVE_AFTER_MONTHS <= 0) {
    logger.warn('ARCHIVE_AFTER_MONTHS=0: 모든 이전 월 데이터를 아카이브합니다');
  }

  const dailyMoved = archiveDaily(cutoffMonth);
  const indexUpdated = updateIndex(cutoffMonth);

  logger.info(`아카이브 완료 - 리포트: ${dailyMoved}건, 인덱스: ${indexUpdated}건`);
}

main();
