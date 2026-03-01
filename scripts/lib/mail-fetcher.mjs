/**
 * Mail Fetcher
 * MS Graph API를 통해 메일 가져오기, HTML을 Markdown으로 변환
 */

import TurndownService from 'turndown';
import { writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger.mjs';
import { INBOX_DIR as KB_INBOX_DIR, MAIL_FETCH_LIMIT, ATTACHMENT_MAX_SIZE_MB, INITIAL_FETCH_DAYS } from './config.mjs';

const INBOX_DIR = join(KB_INBOX_DIR, 'mail');
const ATTACHMENTS_DIR = join(INBOX_DIR, 'attachments');

const MAX_ATTACHMENT_SIZE = ATTACHMENT_MAX_SIZE_MB * 1024 * 1024;

// Turndown 설정
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export class MailFetcher {
  /**
   * @param {{ graphClient: import('./graph-client.mjs').GraphClient, syncState: import('./sync-state.mjs').SyncState, dedupManager: import('./dedup.mjs').DedupManager, logger?: ReturnType<import('./logger.mjs').createLogger> }} deps
   */
  constructor({ graphClient, syncState, dedupManager, logger }) {
    this.graphClient = graphClient;
    this.syncState = syncState;
    this.dedupManager = dedupManager;
    this.logger = logger || createLogger('MailFetcher');
  }

  /**
   * 새 메일 가져오기
   * @returns {Promise<number>} 가져온 메일 수
   */
  async fetchNewMails() {
    this.ensureDirectories();

    // lastSync 기준 또는 최근 7일
    const lastSync = this.syncState.getLastSync('mail');
    const filterDate = lastSync || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.logger.info(`메일 가져오기 시작 (기준: ${filterDate})`);

    // Graph API 호출
    const params = {
      $filter: `receivedDateTime ge ${filterDate}`,
      $top: String(MAIL_FETCH_LIMIT),
      $orderby: 'receivedDateTime desc',
      $select: 'id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments,importance',
    };

    let data;
    try {
      data = await this.graphClient.get('/me/messages', params);
    } catch (err) {
      this.logger.error(`메일 목록 조회 실패: ${err.message}`);
      throw err;
    }

    const messages = data.value || [];
    this.logger.info(`조회된 메일 수: ${messages.length}`);

    let fetchedCount = 0;
    let latestDateTime = lastSync;

    for (const msg of messages) {
      // 중복 체크
      if (this.dedupManager.isProcessed('mail', msg.id)) {
        this.logger.debug(`이미 처리된 메일 건너뜀: ${msg.id}`);
        continue;
      }

      try {
        // 첨부파일 처리
        const attachments = await this.processAttachments(msg);

        // HTML -> Markdown 변환
        const bodyMarkdown = this.convertBodyToMarkdown(msg.body);

        // 메일 데이터 구성
        const mailData = {
          id: msg.id,
          type: 'mail',
          subject: msg.subject || '(제목 없음)',
          from: {
            name: msg.from?.emailAddress?.name || '',
            email: msg.from?.emailAddress?.address || '',
          },
          to: (msg.toRecipients || []).map((r) => ({
            name: r.emailAddress?.name || '',
            email: r.emailAddress?.address || '',
          })),
          receivedDateTime: msg.receivedDateTime,
          bodyMarkdown,
          bodyPreview: msg.bodyPreview || '',
          importance: msg.importance || 'normal',
          attachments,
          fetchedAt: new Date().toISOString(),
        };

        // JSON 파일 저장 (atomic write)
        this.saveMailJson(msg.id, mailData);

        // 중복 처리 표시
        this.dedupManager.markProcessed('mail', msg.id);
        fetchedCount++;

        // 가장 최근 수신 시각 추적
        if (!latestDateTime || msg.receivedDateTime > latestDateTime) {
          latestDateTime = msg.receivedDateTime;
        }

        this.logger.debug(`메일 저장: "${msg.subject}" (${msg.id})`);
      } catch (err) {
        this.logger.error(`메일 처리 실패 (${msg.id}): ${err.message}`);
        // 개별 메일 실패는 다른 메일 처리를 중단하지 않음
      }
    }

    // 동기화 상태 갱신
    if (latestDateTime) {
      this.syncState.updateLastSync('mail', latestDateTime);
    }
    if (fetchedCount > 0) {
      this.syncState.incrementFetched('mail', fetchedCount);
    }

    this.logger.info(`메일 가져오기 완료: ${fetchedCount}건`);
    return fetchedCount;
  }

  /**
   * 첨부파일 처리
   * @param {object} msg - 메일 메시지 객체
   * @returns {Promise<Array>} 첨부파일 정보 배열
   */
  async processAttachments(msg) {
    if (!msg.hasAttachments) return [];

    try {
      const data = await this.graphClient.get(`/me/messages/${msg.id}/attachments`);
      const attachments = data.value || [];
      const result = [];

      for (const att of attachments) {
        // 10MB 초과 첨부파일 건너뜀
        if (att.size && att.size > MAX_ATTACHMENT_SIZE) {
          this.logger.warn(`첨부파일 크기 초과 (${att.size} bytes): ${att.name}`);
          result.push({
            name: att.name || 'unknown',
            size: att.size || 0,
            contentType: att.contentType || '',
            savedPath: null,
            skippedReason: 'size_exceeded',
          });
          continue;
        }

        // contentBytes가 있는 경우에만 저장 (file attachment)
        if (att.contentBytes) {
          const safeName = this.sanitizeFilename(`${msg.id}_${att.name || 'attachment'}`);
          const savedPath = join(ATTACHMENTS_DIR, safeName);
          const tmpPath = savedPath + '.tmp';

          try {
            const buffer = Buffer.from(att.contentBytes, 'base64');
            writeFileSync(tmpPath, buffer);
            renameSync(tmpPath, savedPath);

            result.push({
              name: att.name || 'unknown',
              size: att.size || buffer.length,
              contentType: att.contentType || '',
              savedPath,
            });
            this.logger.debug(`첨부파일 저장: ${safeName}`);
          } catch (err) {
            this.logger.error(`첨부파일 저장 실패 (${att.name}): ${err.message}`);
            result.push({
              name: att.name || 'unknown',
              size: att.size || 0,
              contentType: att.contentType || '',
              savedPath: null,
              skippedReason: 'save_failed',
            });
          }
        } else {
          // item attachment이나 reference attachment 등
          result.push({
            name: att.name || 'unknown',
            size: att.size || 0,
            contentType: att.contentType || '',
            savedPath: null,
            skippedReason: 'no_content_bytes',
          });
        }
      }

      return result;
    } catch (err) {
      this.logger.error(`첨부파일 목록 조회 실패 (${msg.id}): ${err.message}`);
      return [];
    }
  }

  /**
   * 메일 본문을 Markdown으로 변환
   * @param {{ contentType: string, content: string }} body
   * @returns {string}
   */
  convertBodyToMarkdown(body) {
    if (!body || !body.content) return '';

    if (body.contentType === 'html') {
      try {
        return turndownService.turndown(body.content);
      } catch (err) {
        this.logger.warn(`HTML->Markdown 변환 실패, 원본 반환: ${err.message}`);
        // 폴백: HTML 태그 간단 제거
        return body.content.replace(/<[^>]+>/g, '').trim();
      }
    }

    // text 타입은 그대로 반환
    return body.content;
  }

  /**
   * 메일 JSON 파일 저장 (atomic write)
   * @param {string} id
   * @param {object} data
   */
  saveMailJson(id, data) {
    const safeName = this.sanitizeFilename(id);
    const filePath = join(INBOX_DIR, `${safeName}.json`);
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  /**
   * 파일명에 사용할 수 없는 문자 제거
   * @param {string} name
   * @returns {string}
   */
  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
  }

  /**
   * 필요한 디렉토리 생성
   */
  ensureDirectories() {
    if (!existsSync(INBOX_DIR)) {
      mkdirSync(INBOX_DIR, { recursive: true });
    }
    if (!existsSync(ATTACHMENTS_DIR)) {
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    }
  }
}
