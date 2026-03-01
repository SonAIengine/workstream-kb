/**
 * Logger 모듈
 * console + 파일 동시 출력, 날짜별 로그 파일 생성
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './config.mjs';
const LEVELS = ['debug', 'info', 'warn', 'error'];

// 로그 디렉토리 보장
function ensureLogsDir() {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

// 오늘 날짜 기반 로그 파일 경로
function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return join(LOGS_DIR, `${date}.log`);
}

// 로그 한 줄 기록
function writeLog(level, prefix, message) {
  const timestamp = new Date().toISOString();
  const prefixStr = prefix ? `[${prefix}] ` : '';
  const line = `[${timestamp}] [${level.toUpperCase()}] ${prefixStr}${message}`;

  // 콘솔 출력
  const consoleFn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'debug' ? console.debug
    : console.log;
  consoleFn(line);

  // 파일 출력
  try {
    ensureLogsDir();
    appendFileSync(getLogFilePath(), line + '\n', 'utf-8');
  } catch (err) {
    // 파일 기록 실패 시 콘솔에만 경고
    console.error(`[Logger] 파일 기록 실패: ${err.message}`);
  }
}

/**
 * prefix 기반 logger 생성
 * @param {string} prefix - 로그 접두사 (예: 'MailFetcher')
 * @returns {{ debug, info, warn, error }}
 */
export function createLogger(prefix = '') {
  return {
    debug: (msg) => writeLog('debug', prefix, msg),
    info: (msg) => writeLog('info', prefix, msg),
    warn: (msg) => writeLog('warn', prefix, msg),
    error: (msg) => writeLog('error', prefix, msg),
  };
}

// 기본 logger 인스턴스
const logger = createLogger();
export default logger;
