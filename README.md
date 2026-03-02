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

[Getting Started](#-getting-started) · [한국어 문서](README.ko.md) · [Contributing](CONTRIBUTING.md) · [Discussions](https://github.com/SonAIengine/workstream-kb/discussions)

</div>

---

## The Problem

If you work across multiple projects and receive dozens of emails and Teams messages daily, finding "that one message from two weeks ago" becomes painful. Key decisions get buried in chat threads. Action items are forgotten. Technical details vanish.

## The Solution

WorkStream KB turns your daily communication stream into a structured, searchable knowledge base — automatically. One report per day captures everything: decisions, action items, project status, technical details, and schedules.

### What the Report Looks Like

**Decisions, action items, and key quotes — all in one place:**

<img width="1670" alt="Daily report: key summary, today's decisions, and action items with context" src="https://github.com/user-attachments/assets/066de137-0dfe-4dcf-adea-f1932672ad37" />

**Per-project status with progress, attachments, and linked documents:**

<img width="1678" alt="Project status breakdown with technical details and downloadable attachments" src="https://github.com/user-attachments/assets/906799fd-df09-4c75-a15e-c163c77df551" />

**Technical notes, personal/team schedule, and daily stats:**

<img width="1666" alt="Technical memos, schedule split by personal and team, and message statistics" src="https://github.com/user-attachments/assets/c34f9c21-bf8a-4eb8-a278-761c7947e841" />

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

## Prerequisites

Before starting, make sure you have these installed and configured:

| Requirement | Why | Install Guide |
|-------------|-----|---------------|
| **Node.js 20+** | Runtime for fetcher & processor | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| **Claude Code CLI** | AI report generation (processor) | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code/overview) |
| **MS 365 MCP Server** | OAuth token for MS Graph API | [GitHub](https://github.com/softeria-eu/ms-365-mcp-server) |
| **Docker** *(optional)* | Run the Docsify report viewer | [docker.com](https://docs.docker.com/get-docker/) |

### Setting Up MS 365 MCP Server

This is the most important prerequisite. WorkStream KB **shares** the token cache from MS 365 MCP Server, so you don't need a separate OAuth flow.

```bash
# 1. Install the MCP server (follow the repo's README for full details)
#    https://github.com/softeria-eu/ms-365-mcp-server

# 2. Launch and log in with your Microsoft 365 account
#    The server will create these token files:
#      ~/.config/ms-365-mcp/.token-cache.json
#      ~/.config/ms-365-mcp/.selected-account.json

# 3. Verify the token files exist
ls ~/.config/ms-365-mcp/.token-cache.json
ls ~/.config/ms-365-mcp/.selected-account.json
```

> **Note**: If your token cache is stored in a different location, set `MS365_TOKEN_CACHE_PATH` and `MS365_SELECTED_ACCOUNT_PATH` in `.env`.

### Setting Up Claude Code CLI

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify installation
which claude        # e.g., /usr/local/bin/claude
claude --version

# Make sure you have an active Anthropic subscription
claude              # Should start an interactive session
```

> **Note**: If `claude` is installed in a non-standard path, set `CLAUDE_CLI_PATH` in `.env`.

---

## Getting Started

### Step 1: Clone & Install

```bash
git clone https://github.com/SonAIengine/workstream-kb.git
cd workstream-kb
cd scripts && npm install && cd ..
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# REQUIRED: Set KB_ROOT to the absolute path of your workstream-kb directory
KB_ROOT=~/projects/workstream-kb      # Use absolute path or ~

# REQUIRED: Set your display name (used to split "my" vs "others'" action items)
MY_DISPLAY_NAME=John Doe

# REQUIRED: Path to Claude CLI
CLAUDE_CLI_PATH=/usr/local/bin/claude  # Check with: which claude

# OPTIONAL: Adjust data start date (won't fetch data before this date)
DATA_START_DATE=2026-02-01

# Everything else can stay at defaults — see .env.example for full reference
```

### Step 3: Test Manually

```bash
# Collect emails & Teams messages
node scripts/fetcher.mjs

# Check if data was collected
ls inbox/mail/           # Should show .json files
ls inbox/teams-chat/     # Should show .json files

# Generate a daily report (requires data in inbox/)
node scripts/processor.mjs

# Check the report
ls daily/                # Should show {date}.md
cat daily/$(date +%Y-%m-%d).md
```

### Step 4: Set Up Scheduling

Choose **one** of the following based on your OS:

#### Linux (cron)

```bash
crontab -e
```

Add these lines (adjust paths to match your setup):

```cron
# WorkStream KB - Fetcher: every 30 minutes
*/30 * * * * /usr/bin/node /path/to/workstream-kb/scripts/fetcher.mjs >> /path/to/workstream-kb/logs/fetcher-cron.log 2>&1

# WorkStream KB - Processor: daily at 07:00
0 7 * * * /usr/bin/node /path/to/workstream-kb/scripts/processor.mjs >> /path/to/workstream-kb/logs/processor-cron.log 2>&1
```

> **Tip**: Use `which node` to find the exact node path. Create the `logs/` directory first: `mkdir -p /path/to/workstream-kb/logs`

#### macOS (launchd)

```bash
# Copy plist files
cp config/com.kb.fetcher.plist ~/Library/LaunchAgents/
cp config/com.kb.processor.plist ~/Library/LaunchAgents/

# Edit paths in plist files to match your setup, then load:
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.processor.plist
```

### Step 5: View Reports

#### Option A: Docker (recommended)

```bash
# Generate sidebar first
cd scripts && npm run sidebar && cd ..

# Start the viewer
docker compose up -d

# Open in browser
open http://localhost:3939   # macOS
xdg-open http://localhost:3939  # Linux
```

#### Option B: Local (npx serve)

```bash
cd scripts && npm run viewer
# Opens at http://localhost:3000
```

> **Note**: Run `npm run sidebar` after processor generates new reports to update the sidebar navigation.

### Step 6: Claude Code Slash Commands (optional)

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you can install slash commands for quick KB interaction:

```bash
mkdir -p ~/.claude/commands
cp config/kb-search.md config/kb-sync.md config/kb-status.md ~/.claude/commands/
```

| Command | Description |
|---------|-------------|
| `/kb-search {keywords}` | Search the knowledge base |
| `/kb-sync` | Manually trigger fetcher + processor |
| `/kb-status` | View sync status and report stats |

---

## Configuration Reference

All settings are in `.env`. See `.env.example` for defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `KB_ROOT` | `~/workstream-kb` | Root directory of this project (absolute path or `~`) |
| `CLAUDE_CLI_PATH` | `/usr/local/bin/claude` | Absolute path to Claude CLI binary |
| `MY_DISPLAY_NAME` | `손성준` | Your display name (for action item categorization) |
| `MS365_CLIENT_ID` | `084a3e9f-...` | MS 365 MCP Server client ID (usually unchanged) |
| `MS365_TOKEN_CACHE_PATH` | `~/.config/ms-365-mcp/.token-cache.json` | MSAL token cache path |
| `MS365_SELECTED_ACCOUNT_PATH` | `~/.config/ms-365-mcp/.selected-account.json` | Selected account path |
| `MS365_SCOPES` | `Mail.ReadWrite,...` | MS Graph API scopes |
| `MAIL_FETCH_LIMIT` | `50` | Max emails per fetch cycle |
| `TEAMS_CHAT_LIMIT` | `30` | Max Teams chats per fetch cycle |
| `TEAMS_MESSAGE_LIMIT` | `20` | Max messages per chat |
| `ATTACHMENT_MAX_SIZE_MB` | `10` | Skip attachments larger than this |
| `INITIAL_FETCH_DAYS` | `7` | Days to look back on first run |
| `DATA_START_DATE` | `2026-02-01` | Ignore data before this date |
| `ARCHIVE_AFTER_MONTHS` | `6` | Move data older than N months to `archive/` |
| `CLAUDE_TIMEOUT_MS` | `180000` | Claude CLI timeout (ms) |

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

## Docsify Viewer

The built-in viewer renders daily reports in a browser with full-text search.

**Features**: sidebar navigation, full-text search (Korean supported), dark/light theme, front-matter hidden, attachment download links.

**Docker** (nginx, recommended for stable file downloads):
```bash
# First time: generate sidebar
cd scripts && npm run sidebar && cd ..
docker compose up -d    # http://localhost:3939
```

**Local** (npx serve):
```bash
cd scripts && npm run viewer    # http://localhost:3000
```

## Customization

### Report Prompt

Edit `scripts/prompts/daily-report.md` to customize report format, sections, and AI instructions.

### Schedule

- **Fetcher interval**: Adjust cron schedule (default: `*/30 * * * *` = every 30 min)
- **Processor time**: Adjust cron schedule (default: `0 7 * * *` = daily at 07:00)
- **macOS**: Edit `StartInterval` / `Hour`+`Minute` in the plist files

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ENOENT: .token-cache.json` | MS365 MCP Server not set up | Install and log in to [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server) |
| Auth error (exit code 2) | MS365 token expired | Re-login via MS365 MCP Server |
| Empty inbox after fetch | Sync state issue or no new messages | Delete `.state/sync-state.json` and retry |
| `claude: command not found` | Claude CLI not installed or wrong path | Install Claude Code CLI, set `CLAUDE_CLI_PATH` in `.env` |
| Processor timeout | Too many messages or slow model | Increase `CLAUDE_TIMEOUT_MS` in `.env` (default: 180000 = 3 min) |
| Report missing after failure | Claude CLI error | Inbox is preserved on failure; re-run `node scripts/processor.mjs` |
| Docker viewer shows blank page | Sidebar not generated | Run `cd scripts && npm run sidebar` first |
| Attachment download fails in Docker | nginx config issue | Check that `daily/` volume is mounted correctly in `docker-compose.yml` |
| Fetcher fetches old data | `DATA_START_DATE` not set | Set `DATA_START_DATE` in `.env` to your desired start date |

### Checking Logs

```bash
# Fetcher logs
tail -f logs/fetcher-cron.log

# Processor logs (dated)
ls logs/                         # Find today's log
tail -f logs/$(date +%Y-%m-%d).log

# Sync state
cat .state/sync-state.json
```

## License

MIT
