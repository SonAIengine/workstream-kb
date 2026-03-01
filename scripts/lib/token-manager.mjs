/**
 * Token Manager
 * MS365 MCP 서버와 토큰 캐시를 공유하여 인증 처리
 */

import { PublicClientApplication } from '@azure/msal-node';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { createLogger } from './logger.mjs';
import {
  MS365_CLIENT_ID,
  MS365_AUTHORITY,
  MS365_TOKEN_CACHE_PATH,
  MS365_SELECTED_ACCOUNT_PATH,
  MS365_SCOPES,
} from './config.mjs';

const logger = createLogger('TokenManager');

export class TokenManager {
  constructor() {
    this.msalApp = new PublicClientApplication({
      auth: {
        clientId: MS365_CLIENT_ID,
        authority: MS365_AUTHORITY,
      },
    });
  }

  /**
   * 캐시 파일에서 토큰 캐시 로드
   */
  async loadTokenCache() {
    try {
      if (!existsSync(MS365_TOKEN_CACHE_PATH)) {
        logger.warn(`토큰 캐시 파일 없음: ${MS365_TOKEN_CACHE_PATH}`);
        return;
      }
      const data = readFileSync(MS365_TOKEN_CACHE_PATH, 'utf-8');
      this.msalApp.getTokenCache().deserialize(data);
      logger.debug('토큰 캐시 로드 완료');
    } catch (err) {
      logger.error(`토큰 캐시 로드 실패: ${err.message}`);
      throw err;
    }
  }

  /**
   * 토큰 캐시를 파일에 저장 (atomic write)
   */
  async saveTokenCache() {
    try {
      const data = this.msalApp.getTokenCache().serialize();
      const tmpPath = MS365_TOKEN_CACHE_PATH + '.tmp';
      mkdirSync(dirname(MS365_TOKEN_CACHE_PATH), { recursive: true });
      writeFileSync(tmpPath, data, 'utf-8');
      renameSync(tmpPath, MS365_TOKEN_CACHE_PATH);
      logger.debug('토큰 캐시 저장 완료');
    } catch (err) {
      logger.error(`토큰 캐시 저장 실패: ${err.message}`);
      throw err;
    }
  }

  /**
   * 선택된 계정 정보 읽기
   */
  readSelectedAccount() {
    try {
      if (!existsSync(MS365_SELECTED_ACCOUNT_PATH)) {
        logger.warn(`선택된 계정 파일 없음: ${MS365_SELECTED_ACCOUNT_PATH}`);
        return null;
      }
      const data = readFileSync(MS365_SELECTED_ACCOUNT_PATH, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      logger.error(`선택된 계정 읽기 실패: ${err.message}`);
      return null;
    }
  }

  /**
   * macOS 알림 전송 (terminal-notifier)
   */
  notifyAuthFailure(message) {
    try {
      execSync(
        `terminal-notifier -title "KB Sync 인증 오류" -message "${message}" -sound default`,
        { stdio: 'ignore' }
      );
    } catch {
      // terminal-notifier 미설치 시 무시
      logger.debug('terminal-notifier 사용 불가, 알림 건너뜀');
    }
  }

  /**
   * Access token 획득
   * @returns {Promise<string>} access token
   */
  async getAccessToken() {
    // 1. 캐시 로드
    await this.loadTokenCache();

    // 2. 선택된 계정 확인
    const selectedAccount = this.readSelectedAccount();
    if (!selectedAccount) {
      const errMsg = 'MS365 MCP 서버에서 먼저 로그인이 필요합니다';
      this.notifyAuthFailure(errMsg);
      throw new Error(errMsg);
    }

    // 3. 캐시에서 계정 찾기
    const accounts = await this.msalApp.getTokenCache().getAllAccounts();
    const accountId = selectedAccount.accountId || selectedAccount.homeAccountId;
    const account = accounts.find(
      (a) =>
        a.homeAccountId === accountId ||
        a.username === selectedAccount.username
    );

    if (!account) {
      const errMsg = `캐시에서 계정을 찾을 수 없음: ${accountId || selectedAccount.username}`;
      this.notifyAuthFailure(errMsg);
      throw new Error(errMsg);
    }

    // 4. Silent token 획득
    try {
      const result = await this.msalApp.acquireTokenSilent({
        account,
        scopes: MS365_SCOPES,
      });

      // 5. 캐시 저장 (갱신된 토큰 반영)
      await this.saveTokenCache();

      logger.info(`토큰 획득 성공: ${account.username}`);
      return result.accessToken;
    } catch (err) {
      const errMsg = `토큰 갱신 실패 (재로그인 필요): ${err.message}`;
      logger.error(errMsg);
      this.notifyAuthFailure('토큰 만료 - MCP 서버에서 재로그인 필요');
      throw new Error(errMsg);
    }
  }
}
