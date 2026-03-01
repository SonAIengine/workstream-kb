# Knowledge Base Auto-Sync

A personal knowledge base system that automatically collects emails and Microsoft Teams messages via the MS Graph API, classifies them into projects using Claude AI, and stores organized Markdown documents for easy searching.

## Why This Exists

If you work across multiple projects and receive dozens of emails and Teams messages daily, finding "that one message from two weeks ago" becomes painful. This system turns your communication stream into a structured, searchable knowledge base -- automatically.

## How It Works

```
MS Graph API          Fetcher (Layer 1)         Processor (Layer 2)         Knowledge Base
 ┌──────────┐         every 30 min              daily at 07:00
 │  Emails  │────┐    NO AI cost                Uses Claude CLI
 │  Teams   │────┤
 │  Chats   │────┘
 │  Channels│──────►  inbox/*.json  ──────────►  Claude classifies  ──────►  projects/{name}/{YYYY-MM}/*.md
                                                 & summarizes               index.json (search index)
                                                                            daily/{date}.md (digest)
```

**Layer 1 -- Fetcher** runs every 30 minutes with zero AI cost. It pulls new emails, Teams chats, and Teams channel messages from MS Graph API and saves raw JSON to `inbox/`.

**Layer 2 -- Processor** runs once daily (07:00 by default). It reads the inbox, sends items to Claude Code CLI for project classification and summarization, saves Markdown files organized by project and month, generates a daily digest, and updates the search index.

## Project Structure

```
knowledge-base/
├── .env.example                # Configuration template
├── .gitignore
├── README.md
├── scripts/
│   ├── package.json            # Dependencies: @azure/msal-node, turndown, dotenv
│   ├── fetcher.mjs             # Layer 1: Data collection (no AI)
│   ├── processor.mjs           # Layer 2: AI classification + summary
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
│       ├── classify.md         # Classification prompt template
│       └── daily-digest.md     # Daily digest generation prompt
├── config/                     # Reference configs (copy to target locations)
│   ├── kb-search.md            # → ~/.claude/commands/  (slash command)
│   ├── kb-sync.md              # → ~/.claude/commands/  (slash command)
│   ├── kb-status.md            # → ~/.claude/commands/  (slash command)
│   ├── com.kb.fetcher.plist    # → ~/Library/LaunchAgents/
│   └── com.kb.processor.plist  # → ~/Library/LaunchAgents/
├── .state/                     # Runtime state (gitignored)
│   ├── sync-state.json         # Last sync timestamps & counters
│   ├── processed-ids.json      # Deduplication log
│   └── project-keywords.json   # Project classification rules
├── inbox/                      # Staging area for raw data (gitignored)
│   ├── mail/                   # Raw email JSON
│   ├── teams-chat/             # Raw Teams chat JSON
│   └── teams-channel/          # Raw Teams channel JSON
├── projects/                   # Classified Markdown documents (gitignored)
│   ├── _general/               # Items that don't match any project
│   └── {project-name}/         # e.g., "XGEN-2.0", "제주은행"
│       └── {YYYY-MM}/          # Monthly subdirectories
├── daily/                      # Daily digest Markdown files (gitignored)
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
git clone https://github.com/YOUR_USERNAME/knowledge-base.git
cd knowledge-base/scripts
npm install
```

### 2. Create runtime directories

```bash
mkdir -p .state inbox/mail inbox/teams-chat inbox/teams-channel projects daily logs
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings (see [Configuration](#configuration) below).

### 4. Set up project keywords

Create `.state/project-keywords.json` to define your project categories:

```json
{
  "MyProject": {
    "keywords": ["myproject", "MP", "my project"],
    "domains": ["myproject.com"],
    "contacts": []
  },
  "AnotherProject": {
    "keywords": ["another", "AP"],
    "domains": ["another.example.com"],
    "contacts": []
  }
}
```

Also update `scripts/prompts/classify.md` to list your projects so Claude knows how to classify items.

### 5. Ensure MS365 MCP Server is logged in

This project reuses the token cache from [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server). Make sure you have logged in through the MCP server at least once:

```bash
# The token cache should exist at:
ls ~/.config/ms-365-mcp/.token-cache.json
ls ~/.config/ms-365-mcp/.selected-account.json
```

### 6. Test manually

```bash
# Run the fetcher (collects emails and Teams messages)
node scripts/fetcher.mjs

# Run the processor (classifies and generates Markdown)
node scripts/processor.mjs
```

### 7. Install Claude Code slash commands (optional)

```bash
mkdir -p ~/.claude/commands
cp config/kb-search.md ~/.claude/commands/
cp config/kb-sync.md ~/.claude/commands/
cp config/kb-status.md ~/.claude/commands/
```

This enables `/kb-search`, `/kb-sync`, and `/kb-status` inside Claude Code.

### 8. Set up automated scheduling (macOS)

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
| `KB_ROOT` | Knowledge base root directory | `~/knowledge-base` |
| `CLAUDE_CLI_PATH` | Absolute path to Claude Code CLI binary | `/usr/local/bin/claude` |

### Fetcher Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `MAIL_FETCH_LIMIT` | Max emails to fetch per run | `50` |
| `TEAMS_CHAT_LIMIT` | Max Teams chats to scan per run | `30` |
| `TEAMS_MESSAGE_LIMIT` | Max messages per chat/channel | `20` |
| `ATTACHMENT_MAX_SIZE_MB` | Max attachment size to download | `10` |
| `INITIAL_FETCH_DAYS` | How many days back to fetch on first run | `7` |

### Processor Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `BATCH_SIZE` | Items per Claude CLI classification call | `100` |
| `CLAUDE_TIMEOUT_MS` | Timeout for each Claude CLI invocation (ms) | `180000` |

## Key Architecture Decisions

### 2-Layer Hybrid Design

The fetcher (Layer 1) and processor (Layer 2) are intentionally separated:

- **Fetcher** runs frequently (every 30 min) and incurs **zero AI cost**. It only calls MS Graph API and writes raw JSON.
- **Processor** runs once daily and uses Claude Code CLI for classification. This keeps AI costs predictable and low.

### Token Sharing with MS365 MCP Server

Instead of implementing its own OAuth flow, this project reads the MSAL token cache written by the [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server). If the token expires, the processor notifies you via macOS notifications (using `terminal-notifier`) to re-login through the MCP server.

### Atomic File Writes

All file writes use a temp-file-then-rename pattern to prevent corruption if a process is interrupted mid-write.

### Graceful Degradation

The fetcher continues collecting from remaining sources even if one source (e.g., Teams channels) fails. The processor processes whatever was successfully classified, even if some batches fail.

## Customization

### Adding Projects

1. Edit `.state/project-keywords.json` to add keyword rules:

```json
{
  "NewProject": {
    "keywords": ["new-project", "NP", "new project"],
    "domains": ["newproject.com"],
    "contacts": ["john@newproject.com"]
  }
}
```

2. Update `scripts/prompts/classify.md` to include the new project in the classification prompt.

### Modifying Classification Behavior

Edit `scripts/prompts/classify.md` to change how Claude classifies items. The prompt receives a JSON array of items and must return a JSON array with `id`, `project`, `title`, `summary`, `tags`, and `importance` fields.

### Changing the Daily Digest Format

Edit `scripts/prompts/daily-digest.md` to customize the digest output format.

### Adjusting the Schedule

- **Fetcher interval**: Change `StartInterval` in `com.kb.fetcher.plist` (value in seconds; default 1800 = 30 min)
- **Processor time**: Change `Hour` and `Minute` in `com.kb.processor.plist` (default 07:00)

After editing, reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
```

## Claude Code Integration

With the slash commands installed, you can use these directly in Claude Code:

| Command | Description |
|---------|-------------|
| `/kb-search {keywords}` | Search the knowledge base by keyword (searches title, summary, tags, project) |
| `/kb-sync` | Manually trigger fetcher + processor |
| `/kb-status` | View sync status, inbox queue, project stats, and schedule info |

## Adapting to Linux

Replace the macOS launchd plist files with cron jobs:

```bash
# Edit crontab
crontab -e

# Fetcher: every 30 minutes
*/30 * * * * /path/to/node /path/to/knowledge-base/scripts/fetcher.mjs >> /path/to/knowledge-base/logs/fetcher-cron.log 2>&1

# Processor: daily at 07:00
0 7 * * * /path/to/node /path/to/knowledge-base/scripts/processor.mjs >> /path/to/knowledge-base/logs/processor-cron.log 2>&1
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
| processor.mjs | 1 | Error (no items classified, or fatal error) |

## License

MIT
