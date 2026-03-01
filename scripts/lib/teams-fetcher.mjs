/**
 * Teams Fetcher
 * MS Graph API를 통해 Teams 채팅 및 채널 메시지 가져오기
 */

import { writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger.mjs';
import { INBOX_DIR, TEAMS_CHAT_LIMIT, TEAMS_MESSAGE_LIMIT } from './config.mjs';

const CHAT_DIR = join(INBOX_DIR, 'teams-chat');
const CHANNEL_DIR = join(INBOX_DIR, 'teams-channel');

export class TeamsFetcher {
  /**
   * @param {{ graphClient: import('./graph-client.mjs').GraphClient, syncState: import('./sync-state.mjs').SyncState, dedupManager: import('./dedup.mjs').DedupManager, logger?: ReturnType<import('./logger.mjs').createLogger> }} deps
   */
  constructor({ graphClient, syncState, dedupManager, logger }) {
    this.graphClient = graphClient;
    this.syncState = syncState;
    this.dedupManager = dedupManager;
    this.logger = logger || createLogger('TeamsFetcher');
  }

  /**
   * Teams 채팅 메시지 가져오기
   * @returns {Promise<number>} 가져온 메시지 수
   */
  async fetchChats() {
    this.ensureDirectory(CHAT_DIR);

    const lastSync = this.syncState.getLastSync('teamsChat');
    const filterDate = lastSync || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.logger.info(`Teams 채팅 가져오기 시작 (기준: ${filterDate})`);

    // 채팅 목록 조회
    let chats;
    try {
      const data = await this.graphClient.get('/me/chats', { $top: String(TEAMS_CHAT_LIMIT) });
      chats = data.value || [];
    } catch (err) {
      this.logger.error(`채팅 목록 조회 실패: ${err.message}`);
      throw err;
    }

    this.logger.info(`조회된 채팅 수: ${chats.length}`);

    let fetchedCount = 0;
    let latestDateTime = lastSync;

    for (const chat of chats) {
      try {
        // 각 채팅의 메시지 조회
        const msgData = await this.graphClient.get(`/chats/${chat.id}/messages`, { $top: String(TEAMS_MESSAGE_LIMIT) });
        const messages = msgData.value || [];

        for (const msg of messages) {
          // 시스템 메시지 건너뜀
          if (msg.messageType && msg.messageType !== 'message') continue;

          // 클라이언트 사이드 날짜 필터링
          if (msg.createdDateTime && msg.createdDateTime <= filterDate) continue;

          // 고유 ID 생성
          const compositeId = `${chat.id}_${msg.id}`;

          // 중복 체크
          if (this.dedupManager.isProcessed('teamsChat', compositeId)) continue;

          // 메시지 데이터 구성
          const chatData = {
            id: compositeId,
            type: 'teams-chat',
            chatId: chat.id,
            messageId: msg.id,
            from: this.extractSender(msg),
            content: this.stripHtml(msg.body?.content || ''),
            createdDateTime: msg.createdDateTime,
            chatTopic: chat.topic || '',
            fetchedAt: new Date().toISOString(),
          };

          // JSON 저장
          this.saveJson(CHAT_DIR, `${this.sanitize(compositeId)}.json`, chatData);

          // 중복 처리 표시
          this.dedupManager.markProcessed('teamsChat', compositeId);
          fetchedCount++;

          // 최신 시각 추적
          if (!latestDateTime || msg.createdDateTime > latestDateTime) {
            latestDateTime = msg.createdDateTime;
          }

          this.logger.debug(`채팅 메시지 저장: ${compositeId}`);
        }
      } catch (err) {
        // 개별 채팅 실패는 다른 채팅 처리를 중단하지 않음
        this.logger.warn(`채팅 메시지 조회 실패 (${chat.id}): ${err.message}`);
      }
    }

    // 동기화 상태 갱신
    if (latestDateTime) {
      this.syncState.updateLastSync('teamsChat', latestDateTime);
    }
    if (fetchedCount > 0) {
      this.syncState.incrementFetched('teamsChat', fetchedCount);
    }

    this.logger.info(`Teams 채팅 가져오기 완료: ${fetchedCount}건`);
    return fetchedCount;
  }

  /**
   * Teams 채널 메시지 가져오기
   * @returns {Promise<number>} 가져온 메시지 수
   */
  async fetchChannels() {
    this.ensureDirectory(CHANNEL_DIR);

    const lastSync = this.syncState.getLastSync('teamsChannel');
    const filterDate = lastSync || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.logger.info(`Teams 채널 가져오기 시작 (기준: ${filterDate})`);

    // 가입된 팀 목록 조회
    let teams;
    try {
      const data = await this.graphClient.get('/me/joinedTeams');
      teams = data.value || [];
    } catch (err) {
      this.logger.error(`팀 목록 조회 실패: ${err.message}`);
      throw err;
    }

    this.logger.info(`조회된 팀 수: ${teams.length}`);

    let fetchedCount = 0;
    let latestDateTime = lastSync;

    for (const team of teams) {
      // 각 팀의 채널 목록 조회
      let channels;
      try {
        const channelData = await this.graphClient.get(`/teams/${team.id}/channels`);
        channels = channelData.value || [];
      } catch (err) {
        // 403/404: 접근 불가 채널은 건너뜀
        if (this.isAccessDenied(err)) {
          this.logger.warn(`팀 채널 접근 불가 (${team.displayName}): ${err.message}`);
          continue;
        }
        this.logger.error(`팀 채널 조회 실패 (${team.displayName}): ${err.message}`);
        continue;
      }

      for (const channel of channels) {
        try {
          // 채널 메시지 조회
          const msgData = await this.graphClient.get(
            `/teams/${team.id}/channels/${channel.id}/messages`,
            { $top: String(TEAMS_MESSAGE_LIMIT) }
          );
          const messages = msgData.value || [];

          for (const msg of messages) {
            // 시스템 메시지 건너뜀
            if (msg.messageType && msg.messageType !== 'message') continue;

            // 클라이언트 사이드 날짜 필터링
            if (msg.createdDateTime && msg.createdDateTime <= filterDate) continue;

            // 고유 ID 생성
            const compositeId = `${team.id}_${channel.id}_${msg.id}`;

            // 중복 체크
            if (this.dedupManager.isProcessed('teamsChannel', compositeId)) continue;

            // 메시지 데이터 구성
            const channelMsgData = {
              id: compositeId,
              type: 'teams-channel',
              teamId: team.id,
              teamName: team.displayName || '',
              channelId: channel.id,
              channelName: channel.displayName || '',
              messageId: msg.id,
              from: this.extractSender(msg),
              subject: msg.subject || '',
              content: this.stripHtml(msg.body?.content || ''),
              createdDateTime: msg.createdDateTime,
              fetchedAt: new Date().toISOString(),
            };

            // JSON 저장
            this.saveJson(CHANNEL_DIR, `${this.sanitize(compositeId)}.json`, channelMsgData);

            // 중복 처리 표시
            this.dedupManager.markProcessed('teamsChannel', compositeId);
            fetchedCount++;

            // 최신 시각 추적
            if (!latestDateTime || msg.createdDateTime > latestDateTime) {
              latestDateTime = msg.createdDateTime;
            }

            this.logger.debug(`채널 메시지 저장: ${channel.displayName} - ${compositeId}`);
          }
        } catch (err) {
          // 403/404: 접근 불가 채널은 건너뜀
          if (this.isAccessDenied(err)) {
            this.logger.warn(`채널 접근 불가 (${channel.displayName}): ${err.message}`);
            continue;
          }
          this.logger.error(`채널 메시지 조회 실패 (${channel.displayName}): ${err.message}`);
        }
      }
    }

    // 동기화 상태 갱신
    if (latestDateTime) {
      this.syncState.updateLastSync('teamsChannel', latestDateTime);
    }
    if (fetchedCount > 0) {
      this.syncState.incrementFetched('teamsChannel', fetchedCount);
    }

    this.logger.info(`Teams 채널 가져오기 완료: ${fetchedCount}건`);
    return fetchedCount;
  }

  /**
   * 메시지에서 발신자 정보 추출
   * @param {object} msg
   * @returns {{ name: string, email: string }}
   */
  extractSender(msg) {
    const from = msg.from;
    if (!from) return { name: '', email: '' };

    // Teams 메시지의 발신자 구조
    if (from.user) {
      return {
        name: from.user.displayName || '',
        email: from.user.userPrincipalName || from.user.id || '',
      };
    }

    // 앱이나 봇인 경우
    if (from.application) {
      return {
        name: from.application.displayName || 'Bot',
        email: from.application.id || '',
      };
    }

    return { name: '', email: '' };
  }

  /**
   * HTML 태그 제거 (간단한 regex 기반)
   * Teams 메시지는 간단한 HTML이므로 turndown 불필요
   * @param {string} html
   * @returns {string}
   */
  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')       // <br>을 줄바꿈으로
      .replace(/<\/p>/gi, '\n')              // </p>를 줄바꿈으로
      .replace(/<\/div>/gi, '\n')            // </div>를 줄바꿈으로
      .replace(/<[^>]+>/g, '')               // 나머지 태그 제거
      .replace(/&amp;/g, '&')               // HTML 엔티티 변환
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')           // 연속 줄바꿈 정리
      .trim();
  }

  /**
   * 403/404 에러인지 확인
   * @param {Error} err
   * @returns {boolean}
   */
  isAccessDenied(err) {
    const msg = err.message || '';
    return msg.includes('403') || msg.includes('404') || msg.includes('Forbidden') || msg.includes('Not Found');
  }

  /**
   * JSON 파일 저장 (atomic write)
   * @param {string} dir
   * @param {string} filename
   * @param {object} data
   */
  saveJson(dir, filename, data) {
    const filePath = join(dir, filename);
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  /**
   * 파일명 안전 문자로 치환
   * @param {string} name
   * @returns {string}
   */
  sanitize(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
  }

  /**
   * 디렉토리 존재 확인 및 생성
   * @param {string} dir
   */
  ensureDirectory(dir) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
