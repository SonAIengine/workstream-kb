/**
 * 중복 처리 방지 관리자
 * ~/knowledge-base/.state/processed-ids.json에서 처리된 ID 추적
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from './logger.mjs';
import { PROCESSED_IDS_FILE, STATE_DIR } from './config.mjs';

const logger = createLogger('DedupManager');

const PROCESSED_IDS_PATH = PROCESSED_IDS_FILE;

// 타입별 최대 보관 ID 수 (FIFO 방식으로 오래된 것부터 제거)
const MAX_IDS_PER_TYPE = 10000;

const DEFAULT_DATA = {
  mail: [],
  teamsChat: [],
  teamsChannel: [],
};

export class DedupManager {
  constructor() {
    this.data = null;
  }

  /**
   * 처리된 ID 목록 로드
   */
  loadProcessedIds() {
    try {
      if (!existsSync(PROCESSED_IDS_PATH)) {
        logger.info('처리 ID 파일 없음, 기본값으로 초기화');
        this.data = structuredClone(DEFAULT_DATA);
        this.saveProcessedIds();
        return this.data;
      }
      const raw = readFileSync(PROCESSED_IDS_PATH, 'utf-8');
      this.data = JSON.parse(raw);

      // 누락된 키 보정
      for (const key of Object.keys(DEFAULT_DATA)) {
        if (!Array.isArray(this.data[key])) {
          this.data[key] = [];
        }
      }

      logger.debug(
        `처리 ID 로드: mail=${this.data.mail.length}, ` +
        `teamsChat=${this.data.teamsChat.length}, ` +
        `teamsChannel=${this.data.teamsChannel.length}`
      );
      return this.data;
    } catch (err) {
      logger.error(`처리 ID 로드 실패: ${err.message}`);
      this.data = structuredClone(DEFAULT_DATA);
      return this.data;
    }
  }

  /**
   * 특정 ID가 이미 처리되었는지 확인
   * @param {'mail'|'teamsChat'|'teamsChannel'} type
   * @param {string} id
   * @returns {boolean}
   */
  isProcessed(type, id) {
    if (!this.data) this.loadProcessedIds();
    return this.data[type]?.includes(id) ?? false;
  }

  /**
   * ID를 처리 완료로 표시
   * MAX_IDS_PER_TYPE 초과 시 오래된 것부터 제거 (FIFO)
   * @param {'mail'|'teamsChat'|'teamsChannel'} type
   * @param {string} id
   */
  markProcessed(type, id) {
    if (!this.data) this.loadProcessedIds();
    if (!this.data[type]) {
      this.data[type] = [];
    }

    // 이미 존재하면 중복 추가하지 않음
    if (this.data[type].includes(id)) return;

    this.data[type].push(id);

    // FIFO: 최대 수 초과 시 앞에서부터 제거
    if (this.data[type].length > MAX_IDS_PER_TYPE) {
      const overflow = this.data[type].length - MAX_IDS_PER_TYPE;
      this.data[type].splice(0, overflow);
      logger.debug(`${type} 처리 ID ${overflow}개 FIFO 제거`);
    }

    this.saveProcessedIds();
  }

  /**
   * 처리 ID 파일 저장 (atomic write)
   */
  saveProcessedIds() {
    try {
      mkdirSync(dirname(PROCESSED_IDS_PATH), { recursive: true });
      const tmpPath = PROCESSED_IDS_PATH + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(tmpPath, PROCESSED_IDS_PATH);
      logger.debug('처리 ID 저장 완료');
    } catch (err) {
      logger.error(`처리 ID 저장 실패: ${err.message}`);
      throw err;
    }
  }
}
