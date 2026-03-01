#!/usr/bin/env node

/**
 * Knowledge Base Auto-Sync - Layer 1: Data Fetcher
 * 메일, Teams 채팅, Teams 채널 메시지를 가져와 inbox에 저장
 *
 * Exit codes:
 *   0 - 성공
 *   1 - 일반 오류
 *   2 - 인증/토큰 오류 (launchd 알림용)
 */

import { createLogger } from './lib/logger.mjs';
import { TokenManager } from './lib/token-manager.mjs';
import { GraphClient, AuthError } from './lib/graph-client.mjs';
import { SyncState } from './lib/sync-state.mjs';
import { DedupManager } from './lib/dedup.mjs';
import { MailFetcher } from './lib/mail-fetcher.mjs';
import { TeamsFetcher } from './lib/teams-fetcher.mjs';

const logger = createLogger('Fetcher');

async function main() {
  logger.info('=== Knowledge Base 데이터 수집 시작 ===');
  const startTime = Date.now();

  // 모듈 초기화
  const tokenManager = new TokenManager();
  const graphClient = new GraphClient(tokenManager);
  const syncState = new SyncState();
  const dedupManager = new DedupManager();

  // 상태 로드
  syncState.loadState();
  dedupManager.loadProcessedIds();

  // 인증 사전 확인 (실패 시 빠르게 종료)
  try {
    logger.info('인증 토큰 확인 중...');
    await tokenManager.getAccessToken();
    logger.info('인증 성공');
  } catch (err) {
    logger.error(`인증 실패: ${err.message}`);
    process.exit(2);
  }

  // 각 fetcher 생성
  const mailFetcher = new MailFetcher({
    graphClient,
    syncState,
    dedupManager,
    logger: createLogger('MailFetcher'),
  });
  const teamsFetcher = new TeamsFetcher({
    graphClient,
    syncState,
    dedupManager,
    logger: createLogger('TeamsFetcher'),
  });

  // 결과 추적
  let mailCount = 0;
  let chatCount = 0;
  let channelCount = 0;
  let hasError = false;

  // 1. 메일 가져오기
  try {
    mailCount = await mailFetcher.fetchNewMails();
  } catch (err) {
    logger.error(`메일 가져오기 실패: ${err.message}`);
    hasError = true;
  }

  // 2. Teams 채팅 가져오기
  try {
    chatCount = await teamsFetcher.fetchChats();
  } catch (err) {
    logger.error(`Teams 채팅 가져오기 실패: ${err.message}`);
    hasError = true;
  }

  // 3. Teams 채널 가져오기
  try {
    channelCount = await teamsFetcher.fetchChannels();
  } catch (err) {
    logger.error(`Teams 채널 가져오기 실패: ${err.message}`);
    hasError = true;
  }

  // 요약 로그
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(
    `=== 데이터 수집 완료 (${elapsed}s) === ` +
    `메일: ${mailCount}건, 채팅: ${chatCount}건, 채널: ${channelCount}건`
  );

  if (hasError) {
    logger.warn('일부 작업에서 오류 발생 (개별 로그 확인)');
  }

  return hasError ? 1 : 0;
}

/**
 * Fatal 에러 핸들러
 */
function handleFatalError(err) {
  logger.error(`치명적 오류: ${err.message}`);
  logger.error(err.stack || '(스택 트레이스 없음)');

  // AuthError인 경우 exit code 2
  if (err instanceof AuthError || err.message?.includes('토큰') || err.message?.includes('인증')) {
    process.exit(2);
  }
  process.exit(1);
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch(handleFatalError);
