/**
 * MS Graph API 클라이언트
 * TokenManager를 통해 인증하고, 재시도 및 에러 처리 포함
 */

import { createLogger } from './logger.mjs';

const logger = createLogger('GraphClient');

const BASE_URL = 'https://graph.microsoft.com/v1.0';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class GraphClient {
  /**
   * @param {import('./token-manager.mjs').TokenManager} tokenManager
   */
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * GET 요청
   * @param {string} endpoint - API 경로 (예: '/me/messages')
   * @param {Record<string, string>} params - 쿼리 파라미터
   * @returns {Promise<object>}
   */
  async get(endpoint, params = {}) {
    return this.makeRequest('GET', endpoint, { params });
  }

  /**
   * POST 요청
   * @param {string} endpoint - API 경로
   * @param {object} body - 요청 본문
   * @returns {Promise<object>}
   */
  async post(endpoint, body = {}) {
    return this.makeRequest('POST', endpoint, { body });
  }

  /**
   * API 요청 수행 (재시도 로직 포함)
   * @param {'GET'|'POST'} method
   * @param {string} endpoint
   * @param {{ params?: Record<string, string>, body?: object }} options
   * @returns {Promise<object>}
   */
  async makeRequest(method, endpoint, options = {}) {
    const { params = {}, body } = options;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 매 요청마다 토큰 획득 (만료 시 자동 갱신)
        const token = await this.tokenManager.getAccessToken();

        // URL 구성
        const url = new URL(`${BASE_URL}${endpoint}`);
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }

        // 요청 옵션
        const fetchOptions = {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        };

        if (body && method === 'POST') {
          fetchOptions.body = JSON.stringify(body);
        }

        logger.debug(`${method} ${endpoint} (시도 ${attempt}/${MAX_RETRIES})`);

        const response = await fetch(url.toString(), fetchOptions);

        // 401: 인증 오류
        if (response.status === 401) {
          throw new AuthError(`인증 실패 (401): ${endpoint}`);
        }

        // 429: Rate limit - Retry-After 헤더 존중
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
          logger.warn(`Rate limit 도달, ${retryAfter}초 후 재시도 (${attempt}/${MAX_RETRIES})`);
          if (attempt < MAX_RETRIES) {
            await this.sleep(retryAfter * 1000);
            continue;
          }
          throw new Error(`Rate limit 초과, 최대 재시도 횟수 도달: ${endpoint}`);
        }

        // 5xx: 서버 오류 - exponential backoff
        if (response.status >= 500) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          logger.warn(`서버 오류 ${response.status}, ${backoff}ms 후 재시도 (${attempt}/${MAX_RETRIES})`);
          if (attempt < MAX_RETRIES) {
            await this.sleep(backoff);
            continue;
          }
          throw new Error(`서버 오류 ${response.status}, 최대 재시도 횟수 도달: ${endpoint}`);
        }

        // 기타 에러
        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Graph API 오류 ${response.status}: ${errorBody}`);
        }

        // 204 No Content
        if (response.status === 204) {
          return {};
        }

        // JSON 파싱 및 @odata 속성 제거
        const data = await response.json();
        return this.stripOdataProperties(data);

      } catch (err) {
        // AuthError는 재시도하지 않음
        if (err instanceof AuthError) {
          throw err;
        }

        // 마지막 시도에서도 실패
        if (attempt === MAX_RETRIES) {
          logger.error(`요청 실패 (${MAX_RETRIES}회 시도): ${method} ${endpoint} - ${err.message}`);
          throw err;
        }

        // 네트워크 오류 등은 재시도
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn(`요청 오류, ${backoff}ms 후 재시도 (${attempt}/${MAX_RETRIES}): ${err.message}`);
        await this.sleep(backoff);
      }
    }
  }

  /**
   * @odata 접두사 속성 제거 (재귀)
   */
  stripOdataProperties(obj) {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.stripOdataProperties(item));
    }
    if (obj && typeof obj === 'object') {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith('@odata')) continue;
        cleaned[key] = this.stripOdataProperties(value);
      }
      return cleaned;
    }
    return obj;
  }

  /**
   * 지정된 시간만큼 대기
   * @param {number} ms
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
