<div align="center">

# WorkStream KB

**Your AI-powered second brain for work communications**

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Claude](https://img.shields.io/badge/Powered%20by-Claude-6B4FBB?logo=anthropic&logoColor=white)](https://anthropic.com)
[![MS Graph](https://img.shields.io/badge/MS%20Graph-API-0078D4?logo=microsoft&logoColor=white)](https://learn.microsoft.com/en-us/graph/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/github/discussions/SonAIengine/workstream-kb)](https://github.com/SonAIengine/workstream-kb/discussions)

Auto-collect **Emails** & **Microsoft Teams** messages → AI-generated **daily work report** → searchable **personal knowledge base**

[Getting Started](#quick-start) · [한국어 문서](README.ko.md) · [Contributing](CONTRIBUTING.md) · [Discussions](https://github.com/SonAIengine/workstream-kb/discussions)

</div>

<img width="1670" height="1008" alt="image" src="https://github.com/user-attachments/assets/066de137-0dfe-4dcf-adea-f1932672ad37" />
<img width="1678" height="1021" alt="image" src="https://github.com/user-attachments/assets/906799fd-df09-4c75-a15e-c163c77df551" />
<img width="1666" height="1018" alt="image" src="https://github.com/user-attachments/assets/c34f9c21-bf8a-4eb8-a278-761c7947e841" />

Automatically collects work communications (Email, Teams Chat, Teams Channel) and generates a single comprehensive daily report using AI — building a searchable personal knowledge base.
---

## The Problem

If you work across multiple projects and receive dozens of emails and Teams messages daily, finding "that one message from two weeks ago" becomes painful. Key decisions get buried in chat threads. Action items are forgotten. Technical details vanish.

## The Solution

WorkStream KB turns your daily communication stream into a structured, searchable knowledge base — automatically. One report per day captures everything: decisions, action items, project status, technical details, and schedules.

### Sample Report Output

```markdown
## Key Summary
- **Jeju Bank GenAI Platform** kickoff — daily requirements meetings starting Monday 10AM,
  but client requests aggressive timeline shift (April soft-launch / July go-live)

## Today's Decisions
- **[XGEN Docs]** Switched list query from qdrant → PostgreSQL — 3s → 0.1s improvement

## Action Items
| Task | Context | Requester | Due |
|------|---------|-----------|-----|
| Write exec meeting slides | Quarterly review | PM Lee | Tue AM |

## Project Status: Jeju Bank
> "The client wants to move the timeline significantly forward..." — PM Kim
...
```

## Architecture

```
MS Graph API          Fetcher (Layer 1)         Processor (Layer 2)         Knowledge Base
 ┌──────────┐         every 30 min              daily at 07:00
 │  Emails  │────┐    NO AI cost                Claude CLI × 1 call
 │  Teams   │────┤
 │  Chats   │────┘
 │  Channels│──────►  inbox/*.json  ──────────►  Group by room  ──────────►  daily/{date}.md
                                                 Filter noise                + attachments/
                                                 Build JSON input            index.json
                                                 Claude → daily report
```

| Layer | What | When | AI Cost |
|-------|------|------|---------|
| **Fetcher** | Pulls emails, Teams chats/channels via MS Graph API → raw JSON in `inbox/` | Every 30 min | Zero |
| **Processor** | Groups by room, filters noise, calls Claude CLI once → `daily/{date}.md` | Daily 07:00 | ~35K tokens/day |
| **Archiver** | Moves reports older than N months to `archive/` | On demand | Zero |

### Key Design Choices

- **2-Layer Separation**: Frequent collection (free) + daily AI processing (predictable cost)
- **Single Claude Call**: All rooms in one request → better cross-referencing, ~1-2 calls instead of 48+
- **Token Sharing**: Reuses [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server) token cache — no separate OAuth
- **Atomic Writes**: temp-file → rename pattern prevents corruption
- **Graceful Degradation**: One source failing doesn't block others
- **Attachment Preservation**: Email attachments are downloaded and linked in reports

## Report Features

The AI-generated daily report includes:

| Section | Description |
|---------|-------------|
| **Key Summary** | 3-5 most important items with concrete outcomes |
| **Today's Decisions** | Confirmed decisions with rationale and decision-maker |
| **Action Items** | Split into "mine" vs "requested from others" with context and status |
| **Project Status** | Per-project breakdown with today's progress, technical details, risks, next steps |
| **Key Quotes** | Important statements preserved as `>` blockquotes |
| **External Communications** | Client/partner interactions with next actions |
| **Team Activity** | Per-member activity summary |
| **Technical Notes** | Code paths, configs, error analyses for future reference |
| **Schedule** | Split into personal vs team schedule |
| **Attachments** | Email attachments downloaded and linked inline |

## Project Structure

```
workstream-kb/
├── scripts/
│   ├── package.json
│   ├── fetcher.mjs             # Layer 1: Data collection (no AI)
│   ├── processor.mjs           # Layer 2: Daily report generation
│   ├── archiver.mjs            # Archive old data
│   ├── generate-sidebar.mjs    # Docsify sidebar generator
│   ├── lib/
│   │   ├── config.mjs          # Central config (.env)
│   │   ├── token-manager.mjs   # MSAL token management
│   │   ├── graph-client.mjs    # MS Graph API wrapper
│   │   ├── mail-fetcher.mjs    # Email + HTML→Markdown + attachments
│   │   ├── teams-fetcher.mjs   # Teams chat & channel messages
│   │   ├── sync-state.mjs      # Sync timestamp tracking
│   │   ├── dedup.mjs           # Deduplication
│   │   └── logger.mjs          # File + console logging
│   └── prompts/
│       └── daily-report.md     # Report generation prompt template
├── config/                     # launchd plist, slash commands
├── Dockerfile                  # nginx-based viewer container
├── docker-compose.yml          # Docker viewer config
├── nginx.conf                  # Attachment download headers
├── serve.json                  # npx serve download headers
├── index.html                  # Docsify SPA
├── .state/                     # Runtime state (gitignored)
├── inbox/                      # Raw JSON staging (gitignored)
├── daily/                      # Generated reports (gitignored)
│   └── attachments/            # Email attachments per date
├── archive/                    # Old reports (gitignored)
├── logs/                       # Application logs (gitignored)
└── index.json                  # Search index (gitignored)
```

## Prerequisites

- **Node.js 20+** (nvm recommended)
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** with active subscription
- **[MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server)** configured and logged in
- **macOS** for launchd scheduling (Linux: use cron/systemd)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/SonAIengine/workstream-kb.git
cd workstream-kb/scripts && npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Ensure MS365 token exists

```bash
ls ~/.config/ms-365-mcp/.token-cache.json
ls ~/.config/ms-365-mcp/.selected-account.json
```

### 4. Run manually

```bash
node scripts/fetcher.mjs      # Collect emails & Teams messages
node scripts/processor.mjs     # Generate daily report
```

### 5. View reports

```bash
# Option A: Docker (recommended)
docker-compose up -d
open http://localhost:3939

# Option B: Local
cd scripts && npm run viewer
open http://localhost:3000
```

### 6. Automate (macOS launchd)

```bash
cp config/com.kb.fetcher.plist ~/Library/LaunchAgents/
cp config/com.kb.processor.plist ~/Library/LaunchAgents/
# Edit paths in plist files, then:
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.processor.plist
```

### 7. Claude Code slash commands (optional)

```bash
mkdir -p ~/.claude/commands
cp config/kb-search.md config/kb-sync.md config/kb-status.md ~/.claude/commands/
```

| Command | Description |
|---------|-------------|
| `/kb-search {keywords}` | Search the knowledge base |
| `/kb-sync` | Manually trigger fetcher + processor |
| `/kb-status` | View sync status and report stats |

## Configuration

All settings are in `.env`. See `.env.example` for full reference.

| Category | Key Variables |
|----------|--------------|
| **Auth** | `MS365_CLIENT_ID`, `MS365_TOKEN_CACHE_PATH` |
| **Paths** | `KB_ROOT`, `CLAUDE_CLI_PATH` |
| **Fetcher** | `MAIL_FETCH_LIMIT` (50), `TEAMS_CHAT_LIMIT` (30), `ATTACHMENT_MAX_SIZE_MB` (10) |
| **Processor** | `CLAUDE_TIMEOUT_MS` (900000), `MY_DISPLAY_NAME` |
| **Retention** | `DATA_START_DATE`, `ARCHIVE_AFTER_MONTHS` (6) |

## Docsify Viewer

The built-in viewer renders daily reports in a browser with full-text search.

**Features**: sidebar navigation, full-text search (Korean supported), dark/light theme, front-matter hidden, attachment download links.

**Docker** (nginx, recommended for stable file downloads):
```bash
docker-compose up -d    # http://localhost:3939
```

**Local** (npx serve):
```bash
cd scripts && npm run viewer    # http://localhost:3000
```

## Customization

### Report prompt

Edit `scripts/prompts/daily-report.md` to customize report format, sections, and AI instructions.

### Schedule

- **Fetcher interval**: `StartInterval` in `com.kb.fetcher.plist` (seconds, default 1800)
- **Processor time**: `Hour`/`Minute` in `com.kb.processor.plist` (default 07:00)

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Auth error (exit code 2) | MS365 token expired | Re-login via MS365 MCP Server |
| Empty inbox after fetch | Sync state issue | Check `.state/sync-state.json` |
| Processor timeout | Too many messages / slow model | Increase `CLAUDE_TIMEOUT_MS` in `.env` |
| Report missing on failure | Claude CLI error | Inbox is preserved on failure; re-run processor |
| Attachment download stuck | Docker/Colima network | Use local serve (`npm run viewer`) or add `::1 kb.local` to `/etc/hosts` |

## Adapting to Linux

```bash
crontab -e
# Fetcher: every 30 minutes
*/30 * * * * /path/to/node /path/to/scripts/fetcher.mjs >> /path/to/logs/fetcher.log 2>&1
# Processor: daily at 07:00
0 7 * * * /path/to/node /path/to/scripts/processor.mjs >> /path/to/logs/processor.log 2>&1
```

## License

MIT
