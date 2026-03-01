/**
 * Sync State 관리
 * ~/knowledge-base/.state/sync-state.json에서 동기화 상태 추적
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from './logger.mjs';
import { SYNC_STATE_FILE, STATE_DIR } from './config.mjs';

const logger = createLogger('SyncState');

const STATE_PATH = SYNC_STATE_FILE;

// 초기 상태 구조
const DEFAULT_STATE = {
  mail: { lastSync: null, lastMessageId: null, totalFetched: 0 },
  teamsChat: { lastSync: null, totalFetched: 0 },
  teamsChannel: { lastSync: null, totalFetched: 0 },
  processor: { lastRun: null, totalProcessed: 0 },
};

export class SyncState {
  constructor() {
    this.state = null;
  }

  /**
   * 상태 파일 로드
   * @returns {object} 상태 객체
   */
  loadState() {
    try {
      if (!existsSync(STATE_PATH)) {
        logger.info('상태 파일 없음, 기본값으로 초기화');
        this.state = structuredClone(DEFAULT_STATE);
        this.saveState(this.state);
        return this.state;
      }
      const data = readFileSync(STATE_PATH, 'utf-8');
      this.state = JSON.parse(data);
      logger.debug('상태 로드 완료');
      return this.state;
    } catch (err) {
      logger.error(`상태 로드 실패: ${err.message}`);
      this.state = structuredClone(DEFAULT_STATE);
      return this.state;
    }
  }

  /**
   * 상태를 파일에 저장 (atomic write)
   * @param {object} state
   */
  saveState(state) {
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      const tmpPath = STATE_PATH + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
      renameSync(tmpPath, STATE_PATH);
      this.state = state;
      logger.debug('상태 저장 완료');
    } catch (err) {
      logger.error(`상태 저장 실패: ${err.message}`);
      throw err;
    }
  }

  /**
   * 특정 타입의 마지막 동기화 시각 조회
   * @param {'mail'|'teamsChat'|'teamsChannel'} type
   * @returns {string|null} ISO 날짜 문자열
   */
  getLastSync(type) {
    if (!this.state) this.loadState();
    return this.state[type]?.lastSync || null;
  }

  /**
   * 마지막 동기화 시각 갱신
   * @param {'mail'|'teamsChat'|'teamsChannel'} type
   * @param {string} isoString
   */
  updateLastSync(type, isoString) {
    if (!this.state) this.loadState();
    if (!this.state[type]) {
      this.state[type] = { lastSync: null, totalFetched: 0 };
    }
    this.state[type].lastSync = isoString;
    this.saveState(this.state);
    logger.debug(`${type} lastSync 갱신: ${isoString}`);
  }

  /**
   * 가져온 항목 수 증가
   * @param {'mail'|'teamsChat'|'teamsChannel'} type
   * @param {number} count
   */
  incrementFetched(type, count) {
    if (!this.state) this.loadState();
    if (!this.state[type]) {
      this.state[type] = { lastSync: null, totalFetched: 0 };
    }
    this.state[type].totalFetched = (this.state[type].totalFetched || 0) + count;
    this.saveState(this.state);
    logger.debug(`${type} totalFetched +${count} = ${this.state[type].totalFetched}`);
  }
}
