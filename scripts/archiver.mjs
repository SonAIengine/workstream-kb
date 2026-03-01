#!/usr/bin/env node

/**
 * Archiver
 * ARCHIVE_AFTER_MONTHS 이전의 데이터를 archive/ 디렉토리로 이동
 *
 * 대상:
 *   - rooms/{type}/{slug}/{YYYY-MM-DD}.md → archive/rooms/{type}/{slug}/{YYYY-MM-DD}.md
 *   - daily/{date}.md (기준월 이전) → archive/daily/{date}.md
 *
 * index.json의 path도 함께 업데이트
 */

import { readdirSync, renameSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOMS_DIR, DAILY_DIR, ARCHIVE_DIR, INDEX_FILE, ARCHIVE_AFTER_MONTHS } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';

const logger = createLogger('Archiver');

/**
 * 아카이브 기준월 계산 (현재 월 - ARCHIVE_AFTER_MONTHS)
 * @returns {string} "YYYY-MM" 형식
 */
function getCutoffMonth() {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - ARCHIVE_AFTER_MONTHS, 1);
  const yyyy = cutoff.getFullYear();
  const mm = String(cutoff.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * 디렉토리 재귀 생성
 */
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * rooms/ 하위 파일 아카이브
 * rooms/{type}/{slug}/{YYYY-MM-DD}.md 중 기준월 이전 파일 이동
 * @param {string} cutoffMonth
 * @returns {number} 이동된 파일 수
 */
function archiveRooms(cutoffMonth) {
  if (!existsSync(ROOMS_DIR)) return 0;

  let movedCount = 0;

  const types = readdirSync(ROOMS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const type of types) {
    const typePath = join(ROOMS_DIR, type.name);
    const slugDirs = readdirSync(typePath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const slugDir of slugDirs) {
      const slugPath = join(typePath, slugDir.name);
      const files = readdirSync(slugPath)
        .filter((f) => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

      for (const file of files) {
        // 파일명에서 YYYY-MM 추출
        const fileMonth = file.slice(0, 7);
        if (fileMonth >= cutoffMonth) continue;

        const src = join(slugPath, file);
        const dstDir = join(ARCHIVE_DIR, 'rooms', type.name, slugDir.name);
        ensureDir(dstDir);
        const dst = join(dstDir, file);

        try {
          renameSync(src, dst);
          movedCount++;
          logger.info(`아카이브: rooms/${type.name}/${slugDir.name}/${file}`);
        } catch (err) {
          logger.error(`아카이브 실패 (${src}): ${err.message}`);
        }
      }

      // 빈 slug 디렉토리 정리
      try {
        const remaining = readdirSync(slugPath);
        if (remaining.length === 0) {
          rmdirSync(slugPath);
          logger.info(`빈 디렉토리 삭제: ${type.name}/${slugDir.name}`);
        }
      } catch {
        // 무시
      }
    }

    // 빈 type 디렉토리 정리
    try {
      const remaining = readdirSync(typePath);
      if (remaining.length === 0) {
        rmdirSync(typePath);
      }
    } catch {
      // 무시
    }
  }

  return movedCount;
}

/**
 * daily/ 하위 파일 아카이브
 * @param {string} cutoffMonth
 * @returns {number} 이동된 파일 수
 */
function archiveDaily(cutoffMonth) {
  if (!existsSync(DAILY_DIR)) return 0;

  let movedCount = 0;
  const files = readdirSync(DAILY_DIR)
    .filter((f) => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

  const archiveDailyDir = join(ARCHIVE_DIR, 'daily');

  for (const file of files) {
    // 파일명에서 YYYY-MM 추출
    const fileMonth = file.slice(0, 7); // "2026-02"
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

/**
 * index.json의 path 업데이트 (rooms/ → archive/rooms/)
 * @param {string} cutoffMonth
 * @returns {number} 업데이트된 엔트리 수
 */
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

    // rooms/{type}/{slug}/{YYYY-MM-DD}.md 패턴 매칭
    const roomMatch = entry.path.match(/^rooms\/([^/]+)\/([^/]+)\/(\d{4}-\d{2})-\d{2}\.md$/);
    if (roomMatch) {
      const month = roomMatch[3];
      if (month < cutoffMonth) {
        entry.path = entry.path.replace(/^rooms\//, 'archive/rooms/');
        updatedCount++;
      }
    }

    // daily/{YYYY-MM-DD}.md 패턴 매칭
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

  const roomsMoved = archiveRooms(cutoffMonth);
  const dailyMoved = archiveDaily(cutoffMonth);
  const indexUpdated = updateIndex(cutoffMonth);

  logger.info(`아카이브 완료 - 채팅방: ${roomsMoved}건, 다이제스트: ${dailyMoved}건, 인덱스: ${indexUpdated}건`);
}

main();
