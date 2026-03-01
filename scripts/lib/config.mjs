/**
 * 중앙 설정 모듈
 * .env 파일에서 설정을 로드하고 기본값을 제공
 */

import { config } from 'dotenv';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

// .env 로드 (scripts/ 상위 = KB_ROOT)
const envPath = resolve(new URL('..', import.meta.url).pathname, '..', '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? p.replace('~', homedir()) : p;
}

function env(key, defaultValue) {
  return process.env[key] || defaultValue;
}

function envInt(key, defaultValue) {
  const v = process.env[key];
  return v ? parseInt(v, 10) : defaultValue;
}

// ─── MS365 ─────────────────────────────────────────────────────

export const MS365_CLIENT_ID = env('MS365_CLIENT_ID', '084a3e9f-a9f4-43f7-89f9-d229cf97853e');
export const MS365_AUTHORITY = env('MS365_AUTHORITY', 'https://login.microsoftonline.com/common');
export const MS365_TOKEN_CACHE_PATH = expandHome(
  env('MS365_TOKEN_CACHE_PATH', '~/.config/ms-365-mcp/.token-cache.json')
);
export const MS365_SELECTED_ACCOUNT_PATH = expandHome(
  env('MS365_SELECTED_ACCOUNT_PATH', '~/.config/ms-365-mcp/.selected-account.json')
);
export const MS365_SCOPES = env(
  'MS365_SCOPES',
  'Mail.ReadWrite,Chat.Read,ChatMessage.Read,Team.ReadBasic.All,Channel.ReadBasic.All,ChannelMessage.Read.All,User.Read'
).split(',');

// ─── Paths ─────────────────────────────────────────────────────

export const KB_ROOT = expandHome(env('KB_ROOT', '~/workstream-kb'));
export const CLAUDE_CLI_PATH = expandHome(env('CLAUDE_CLI_PATH', '/usr/local/bin/claude'));

// 파생 경로
export const SCRIPTS_DIR = join(KB_ROOT, 'scripts');
export const INBOX_DIR = join(KB_ROOT, 'inbox');
export const DAILY_DIR = join(KB_ROOT, 'daily');
export const STATE_DIR = join(KB_ROOT, '.state');
export const LOGS_DIR = join(KB_ROOT, 'logs');
export const INDEX_FILE = join(KB_ROOT, 'index.json');
export const SYNC_STATE_FILE = join(STATE_DIR, 'sync-state.json');
export const PROCESSED_IDS_FILE = join(STATE_DIR, 'processed-ids.json');

// ─── Display ──────────────────────────────────────────────────────

export const MY_DISPLAY_NAME = env('MY_DISPLAY_NAME', '손성준');

// ─── Fetcher Settings ──────────────────────────────────────────

export const MAIL_FETCH_LIMIT = envInt('MAIL_FETCH_LIMIT', 50);
export const TEAMS_CHAT_LIMIT = envInt('TEAMS_CHAT_LIMIT', 30);
export const TEAMS_MESSAGE_LIMIT = envInt('TEAMS_MESSAGE_LIMIT', 20);
export const ATTACHMENT_MAX_SIZE_MB = envInt('ATTACHMENT_MAX_SIZE_MB', 10);
export const INITIAL_FETCH_DAYS = envInt('INITIAL_FETCH_DAYS', 7);

// ─── Retention Policy ─────────────────────────────────────────

export const DATA_START_DATE = env('DATA_START_DATE', '2026-02-01');
export const ARCHIVE_AFTER_MONTHS = envInt('ARCHIVE_AFTER_MONTHS', 6);
export const ARCHIVE_DIR = join(KB_ROOT, 'archive');

// ─── Processor Settings ────────────────────────────────────────

export const BATCH_SIZE = envInt('BATCH_SIZE', 100);
export const CLAUDE_TIMEOUT_MS = envInt('CLAUDE_TIMEOUT_MS', 300000);
