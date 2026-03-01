# WorkStream KB

업무 커뮤니케이션(메일, Teams)을 자동 수집하고 AI로 하루 종합 업무 리포트를 생성하여 검색 가능한 지식 베이스를 구축하는 시스템.

## Why This Exists

If you work across multiple projects and receive dozens of emails and Teams messages daily, finding "that one message from two weeks ago" becomes painful. This system turns your communication stream into a structured, searchable knowledge base -- automatically.

## How It Works

```
MS Graph API          Fetcher (Layer 1)         Processor (Layer 2)         Knowledge Base
 ┌──────────┐         every 30 min              daily at 07:00
 │  Emails  │────┐    NO AI cost                Claude CLI 1 call
 │  Teams   │────┤
 │  Chats   │────┘
 │  Channels│──────►  inbox/*.json  ──────────►  Group by room  ──────────►  daily/{date}.md
                                                 Filter noise                index.json (search index)
                                                 Build JSON input
                                                 Claude → daily report
```

**Layer 1 -- Fetcher** runs every 30 minutes with zero AI cost. It pulls new emails, Teams chats, and Teams channel messages from MS Graph API and saves raw JSON to `inbox/`.

**Layer 2 -- Processor** runs once daily (07:00 by default). It groups inbox items by chat room, filters noise (greetings, acknowledgements, emoji-only messages), builds a single structured JSON input, calls Claude Code CLI once to generate a comprehensive daily report, and saves it to `daily/{date}.md`.

## Project Structure

```
workstream-kb/
├── .env.example                # Configuration template
├── .gitignore
├── README.md
├── scripts/
│   ├── package.json            # Dependencies: @azure/msal-node, turndown, dotenv
│   ├── fetcher.mjs             # Layer 1: Data collection (no AI)
│   ├── processor.mjs           # Layer 2: Daily report generation (1 Claude call)
│   ├── archiver.mjs            # Archive old data
│   ├── generate-sidebar.mjs    # Generate Docsify sidebar
│   ├── lib/
│   │   ├── config.mjs          # Central config (reads .env)
│   │   ├── token-manager.mjs   # MSAL token (shares cache with MS365 MCP Server)
│   │   ├── graph-client.mjs    # MS Graph API wrapper
│   │   ├── mail-fetcher.mjs    # Email fetching + HTML-to-Markdown + attachments
│   │   ├── teams-fetcher.mjs   # Teams chat & channel message fetching
│   │   ├── sync-state.mjs      # Tracks last sync timestamps per source
│   │   ├── dedup.mjs           # Deduplication via processed-ids tracking
│   │   └── logger.mjs          # File + console logging
│   └── prompts/
│       └── daily-report.md     # Daily report prompt template
├── config/                     # Reference configs (copy to target locations)
│   ├── kb-search.md            # → ~/.claude/commands/  (slash command)
│   ├── kb-sync.md              # → ~/.claude/commands/  (slash command)
│   ├── kb-status.md            # → ~/.claude/commands/  (slash command)
│   ├── com.kb.fetcher.plist    # → ~/Library/LaunchAgents/
│   └── com.kb.processor.plist  # → ~/Library/LaunchAgents/
├── .state/                     # Runtime state (gitignored)
│   ├── sync-state.json         # Last sync timestamps & counters
│   └── processed-ids.json      # Deduplication log
├── inbox/                      # Staging area for raw data (gitignored)
│   ├── mail/                   # Raw email JSON
│   ├── teams-chat/             # Raw Teams chat JSON
│   └── teams-channel/          # Raw Teams channel JSON
├── daily/                      # Daily comprehensive reports (gitignored)
├── archive/                    # 6+ month old reports (gitignored)
│   └── daily/
├── logs/                       # Application logs (gitignored)
└── index.json                  # Search index (gitignored)
```

## Prerequisites

- **Node.js 20+** (managed via nvm recommended)
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** with an active subscription
- **[MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server)** configured and logged in (this project shares its token cache -- no separate OAuth setup needed)
- **macOS** for launchd scheduling (Linux users can adapt the plist files to cron or systemd timers)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/SonAIengine/workstream-kb.git
cd workstream-kb/scripts
npm install
```

### 2. Create runtime directories

```bash
mkdir -p .state inbox/mail inbox/teams-chat inbox/teams-channel daily logs
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings (see [Configuration](#configuration) below).

### 4. Ensure MS365 MCP Server is logged in

This project reuses the token cache from [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server). Make sure you have logged in through the MCP server at least once:

```bash
# The token cache should exist at:
ls ~/.config/ms-365-mcp/.token-cache.json
ls ~/.config/ms-365-mcp/.selected-account.json
```

### 5. Test manually

```bash
# Run the fetcher (collects emails and Teams messages)
node scripts/fetcher.mjs

# Run the processor (generates daily comprehensive report)
node scripts/processor.mjs
```

### 6. Install Claude Code slash commands (optional)

```bash
mkdir -p ~/.claude/commands
cp config/kb-search.md ~/.claude/commands/
cp config/kb-sync.md ~/.claude/commands/
cp config/kb-status.md ~/.claude/commands/
```

This enables `/kb-search`, `/kb-sync`, and `/kb-status` inside Claude Code.

### 7. Set up automated scheduling (macOS)

```bash
# Copy and edit the plist files (update paths to match your system)
cp config/com.kb.fetcher.plist ~/Library/LaunchAgents/
cp config/com.kb.processor.plist ~/Library/LaunchAgents/

# Load the agents
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.processor.plist
```

> **Important:** Edit the plist files to update Node.js paths, HOME directory, and any other system-specific values before loading.

## Configuration

The `.env` file controls all settings. Copy `.env.example` and edit:

### MS365 Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `MS365_CLIENT_ID` | Azure AD app client ID (same as MS365 MCP Server) | `084a3e9f-...` |
| `MS365_AUTHORITY` | Azure AD authority URL | `https://login.microsoftonline.com/common` |
| `MS365_TOKEN_CACHE_PATH` | Path to shared MSAL token cache | `~/.config/ms-365-mcp/.token-cache.json` |
| `MS365_SELECTED_ACCOUNT_PATH` | Path to selected account file | `~/.config/ms-365-mcp/.selected-account.json` |
| `MS365_SCOPES` | Comma-separated MS Graph API scopes | `Mail.ReadWrite,Chat.Read,...` |

### Paths

| Variable | Description | Default |
|----------|-------------|---------|
| `KB_ROOT` | WorkStream KB root directory | `~/workstream-kb` |
| `CLAUDE_CLI_PATH` | Absolute path to Claude Code CLI binary | `/usr/local/bin/claude` |

### Fetcher Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `MAIL_FETCH_LIMIT` | Max emails to fetch per run | `50` |
| `TEAMS_CHAT_LIMIT` | Max Teams chats to scan per run | `30` |
| `TEAMS_MESSAGE_LIMIT` | Max messages per chat/channel | `20` |
| `ATTACHMENT_MAX_SIZE_MB` | Max attachment size to download | `10` |
| `INITIAL_FETCH_DAYS` | How many days back to fetch on first run | `7` |

### Retention Policy

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_START_DATE` | Earliest date to fetch data from (YYYY-MM-DD) | `2026-02-01` |
| `ARCHIVE_AFTER_MONTHS` | Move data older than N months to `archive/` | `6` |

### Processor Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_TIMEOUT_MS` | Timeout for Claude CLI invocation (ms) | `180000` |
| `MY_DISPLAY_NAME` | Your Teams display name (for action item categorization) | `손성준` |

## Retention Policy

Data collection starts from `DATA_START_DATE` (default: 2026-02-01). Fetchers will never retrieve data before this date, even after a sync-state reset.

After `ARCHIVE_AFTER_MONTHS` months (default: 6), daily reports are automatically moved to `archive/daily/`.

Run the archiver manually or via cron:

```bash
node scripts/archiver.mjs
```

The archiver updates `index.json` paths so search continues to work for archived entries.

## Key Architecture Decisions

### 2-Layer Hybrid Design

The fetcher (Layer 1) and processor (Layer 2) are intentionally separated:

- **Fetcher** runs frequently (every 30 min) and incurs **zero AI cost**. It only calls MS Graph API and writes raw JSON.
- **Processor** runs once daily and uses Claude Code CLI for report generation. This keeps AI costs predictable and low.

### Single Daily Report (v3)

Instead of generating per-room summaries, the processor groups all messages by room, filters noise, and sends the entire day's data to Claude in a single call. This approach:

- **Reduces AI cost dramatically**: 1-2 Claude calls instead of 48+ (one per room)
- **Produces better output**: Claude sees the full day's context and can cross-reference across rooms
- **Simplifies architecture**: No intermediate room files, no room-map cache
- **Faster execution**: ~15 seconds instead of ~6 minutes

### Token Sharing with MS365 MCP Server

Instead of implementing its own OAuth flow, this project reads the MSAL token cache written by the [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server). If the token expires, the processor notifies you via macOS notifications (using `terminal-notifier`) to re-login through the MCP server.

### Atomic File Writes

All file writes use a temp-file-then-rename pattern to prevent corruption if a process is interrupted mid-write.

### Graceful Degradation

The fetcher continues collecting from remaining sources even if one source (e.g., Teams channels) fails. The processor processes whatever data it can, even if some items fail to parse.

## Customization

### Modifying Report Behavior

Edit `scripts/prompts/daily-report.md` to change how Claude generates the daily report. The prompt receives a JSON object with all rooms and their messages, and must return a comprehensive Markdown report.

### Adjusting the Schedule

- **Fetcher interval**: Change `StartInterval` in `com.kb.fetcher.plist` (value in seconds; default 1800 = 30 min)
- **Processor time**: Change `Hour` and `Minute` in `com.kb.processor.plist` (default 07:00)

After editing, reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
```

## Docsify Viewer

KB 문서를 브라우저에서 확인할 수 있는 로컬 뷰어입니다. 빌드 없이 마크다운을 동적 로드하며 전문 검색을 지원합니다.

```bash
cd scripts
npm run viewer      # 사이드바 생성 + localhost:3000 시작
npm run sidebar     # 사이드바만 재생성
```

브라우저에서 http://localhost:3000 접속하면:

- **사이드바**: 날짜별 리포트 네비게이션
- **검색**: 전문 검색 (한국어 지원)
- **테마**: OS 설정에 따라 다크/라이트 자동 전환
- **front-matter**: YAML 메타데이터 자동 숨김

> `_sidebar.md`는 `scripts/generate-sidebar.mjs`로 자동 생성되며 gitignore 대상입니다. 새 문서 추가 후 `npm run sidebar`를 실행하세요.

## Claude Code Integration

With the slash commands installed, you can use these directly in Claude Code:

| Command | Description |
|---------|-------------|
| `/kb-search {keywords}` | Search the knowledge base by keyword |
| `/kb-sync` | Manually trigger fetcher + processor |
| `/kb-status` | View sync status, inbox queue, and report stats |

## Adapting to Linux

Replace the macOS launchd plist files with cron jobs:

```bash
# Edit crontab
crontab -e

# Fetcher: every 30 minutes
*/30 * * * * /path/to/node /path/to/workstream-kb/scripts/fetcher.mjs >> /path/to/workstream-kb/logs/fetcher-cron.log 2>&1

# Processor: daily at 07:00
0 7 * * * /path/to/node /path/to/workstream-kb/scripts/processor.mjs >> /path/to/workstream-kb/logs/processor-cron.log 2>&1
```

## Troubleshooting

### Token / Authentication errors (exit code 2)

The fetcher exits with code 2 when authentication fails. This usually means the MS365 MCP Server token has expired. Fix by logging in again through the MCP server.

### "inbox empty" but expecting data

- Check `logs/` for fetcher error output
- Verify `.state/sync-state.json` has recent `lastSync` timestamps
- Run `node scripts/fetcher.mjs` manually to see real-time output

### Processor produces no output

- Ensure `inbox/` directories contain `.json` files (run fetcher first)
- Verify Claude Code CLI is installed and accessible at the path in `.env`
- Check that `CLAUDE_CLI_PATH` points to the correct binary (`which claude`)

## Exit Codes

| Script | Code | Meaning |
|--------|------|---------|
| fetcher.mjs | 0 | Success |
| fetcher.mjs | 1 | General error (partial data may have been collected) |
| fetcher.mjs | 2 | Authentication / token error |
| processor.mjs | 0 | Success |
| processor.mjs | 1 | Error (no data processed, or fatal error) |

## License

MIT
