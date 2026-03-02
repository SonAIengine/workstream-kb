<div align="center">

# WorkStream KB

**업무 커뮤니케이션을 위한 AI 기반 세컨드 브레인**

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Claude](https://img.shields.io/badge/Powered%20by-Claude-6B4FBB?logo=anthropic&logoColor=white)](https://anthropic.com)
[![MS Graph](https://img.shields.io/badge/MS%20Graph-API-0078D4?logo=microsoft&logoColor=white)](https://learn.microsoft.com/en-us/graph/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/github/discussions/SonAIengine/workstream-kb)](https://github.com/SonAIengine/workstream-kb/discussions)

**메일** & **Microsoft Teams** 자동 수집 → AI **일일 업무 리포트** 생성 → 검색 가능한 **개인 지식 베이스**

[시작하기](#-시작하기) · [English Docs](README.md) · [기여 가이드](CONTRIBUTING.md) · [토론](https://github.com/SonAIengine/workstream-kb/discussions)

</div>

---

## 왜 만들었나

여러 프로젝트를 동시에 진행하면서 매일 수십 개의 메일과 Teams 메시지를 받다 보면, "2주 전에 누가 뭐라고 했더라?"를 찾는 게 고통이 됩니다. 중요한 의사결정은 채팅 스레드에 묻히고, 액션 아이템은 잊히고, 기술 디테일은 사라집니다.

## 어떻게 해결하나

WorkStream KB는 하루의 커뮤니케이션을 자동으로 수집하여 **하루 1개 종합 리포트**로 정리합니다. 의사결정, 액션 아이템, 프로젝트 현황, 기술 메모, 일정까지 한 문서에서 파악 가능합니다.

### 리포트 예시

**의사결정, 액션 아이템, 핵심 발언 — 한눈에 파악:**

<img width="1670" alt="일일 리포트: 핵심 요약, 오늘의 의사결정, 배경/맥락이 포함된 액션 아이템" src="https://github.com/user-attachments/assets/066de137-0dfe-4dcf-adea-f1932672ad37" />

**프로젝트별 현황, 첨부파일, 관련 문서 링크:**

<img width="1678" alt="프로젝트별 진행 상황, 기술 상세, 다운로드 가능한 첨부파일" src="https://github.com/user-attachments/assets/906799fd-df09-4c75-a15e-c163c77df551" />

**기술 메모, 개인/팀 일정, 일일 통계:**

<img width="1666" alt="기술 메모, 개인/팀으로 구분된 일정, 메시지 통계" src="https://github.com/user-attachments/assets/c34f9c21-bf8a-4eb8-a278-761c7947e841" />

## 아키텍처

```
MS Graph API          Fetcher (Layer 1)         Processor (Layer 2)         Knowledge Base
 ┌──────────┐         30분마다                   매일 07:00
 │  메일    │────┐    AI 비용 없음               Claude CLI × 1회 호출
 │  Teams   │────┤
 │  채팅    │────┘
 │  채널    │──────►  inbox/*.json  ──────────►  채팅방별 그룹화  ──────────►  daily/{date}.md
                                                 노이즈 필터링                + attachments/
                                                 JSON 구성                    index.json
                                                 Claude → 일일 리포트
```

| 레이어 | 역할 | 실행 주기 | AI 비용 |
|--------|------|-----------|---------|
| **Fetcher** | MS Graph API로 메일/Teams 수집 → `inbox/` JSON 저장 | 30분마다 | 없음 |
| **Processor** | 채팅방별 그룹화, 노이즈 필터, Claude 1회 호출 → `daily/{date}.md` | 매일 07:00 | ~35K 토큰/일 |
| **Archiver** | N개월 이전 리포트를 `archive/`로 이동 | 수동 실행 | 없음 |

### 핵심 설계 원칙

- **2-Layer 분리**: 잦은 수집(무료) + 하루 1회 AI 처리(예측 가능한 비용)
- **Claude 1회 호출**: 모든 채팅방을 한 번에 전달 → 맥락 연결 우수, 48회 → 1-2회
- **토큰 공유**: [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server) 토큰 캐시 재사용 — 별도 OAuth 불필요
- **Atomic Write**: temp 파일 → rename 패턴으로 파일 손상 방지
- **Graceful Degradation**: 한 소스 실패 시 나머지 계속 수집
- **첨부파일 보존**: 메일 첨부파일 다운로드 후 리포트에 링크

## 리포트 구성

AI가 생성하는 일일 리포트에 포함되는 섹션:

| 섹션 | 설명 |
|------|------|
| **핵심 요약** | 오늘의 3-5가지 핵심 사항 (구체적 결과 포함) |
| **오늘의 의사결정** | 확정된 결정 사항 + 배경/이유 + 결정자 |
| **액션 아이템** | "내가 할 건" / "요청한 건" 분리, 배경/맥락/현재 상태 포함 |
| **프로젝트별 현황** | 오늘 진행 상황, 기술 상세, 이슈/리스크, 다음 단계 |
| **핵심 발언 인용** | 중요한 지시/수치/결정을 `>` 인용으로 원문 보존 |
| **외부 대응** | 고객사/파트너 커뮤니케이션 + 다음 액션 |
| **팀 활동** | 팀원별 활동 요약 |
| **기술 메모** | 코드 경로, 설정값, 에러 분석 등 나중에 참조할 정보 |
| **일정** | 내 일정 / 팀 일정 분리 |
| **첨부파일** | 메일 첨부파일 다운로드 + 인라인 링크 |

## 사전 요구사항

시작하기 전에 아래 도구들을 설치하고 설정하세요:

| 요구사항 | 용도 | 설치 가이드 |
|----------|------|-------------|
| **Node.js 20+** | fetcher/processor 실행 | [nodejs.org](https://nodejs.org/) 또는 `nvm install 20` |
| **Claude Code CLI** | AI 리포트 생성 (processor) | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code/overview) |
| **MS 365 MCP Server** | MS Graph API OAuth 토큰 | [GitHub](https://github.com/softeria-eu/ms-365-mcp-server) |
| **Docker** *(선택)* | Docsify 리포트 뷰어 실행 | [docker.com](https://docs.docker.com/get-docker/) |

### MS 365 MCP Server 설정

가장 중요한 사전 준비입니다. WorkStream KB는 MS 365 MCP Server의 토큰 캐시를 **공유**하므로 별도 OAuth 흐름이 필요 없습니다.

```bash
# 1. MCP 서버 설치 (상세한 설치 방법은 해당 리포 README 참고)
#    https://github.com/softeria-eu/ms-365-mcp-server

# 2. 서버를 실행하고 Microsoft 365 계정으로 로그인
#    로그인하면 아래 토큰 파일이 생성됩니다:
#      ~/.config/ms-365-mcp/.token-cache.json
#      ~/.config/ms-365-mcp/.selected-account.json

# 3. 토큰 파일이 존재하는지 확인
ls ~/.config/ms-365-mcp/.token-cache.json
ls ~/.config/ms-365-mcp/.selected-account.json
```

> **참고**: 토큰 캐시가 다른 경로에 있다면 `.env`에서 `MS365_TOKEN_CACHE_PATH`와 `MS365_SELECTED_ACCOUNT_PATH`를 수정하세요.

### Claude Code CLI 설정

```bash
# Claude Code CLI 설치
npm install -g @anthropic-ai/claude-code

# 설치 확인
which claude        # 예: /usr/local/bin/claude
claude --version

# Anthropic 구독이 활성화되어 있는지 확인
claude              # 대화형 세션이 시작되면 정상
```

> **참고**: `claude`가 기본 경로가 아닌 곳에 설치되었다면 `.env`에서 `CLAUDE_CLI_PATH`를 수정하세요.

---

## 시작하기

### 1단계: 설치

```bash
git clone https://github.com/SonAIengine/workstream-kb.git
cd workstream-kb
cd scripts && npm install && cd ..
```

### 2단계: 환경 설정

```bash
cp .env.example .env
```

`.env` 파일을 편집하세요:

```bash
# 필수: workstream-kb 디렉토리의 절대 경로 설정
KB_ROOT=~/projects/workstream-kb      # 절대 경로 또는 ~ 사용 가능

# 필수: 본인 표시 이름 (액션 아이템에서 "내가 할 건" vs "요청한 건" 구분에 사용)
MY_DISPLAY_NAME=홍길동

# 필수: Claude CLI 경로
CLAUDE_CLI_PATH=/usr/local/bin/claude  # which claude 로 확인

# 선택: 데이터 수집 시작일 (이전 데이터는 가져오지 않음)
DATA_START_DATE=2026-02-01

# 나머지는 기본값으로 사용 가능 — .env.example 참고
```

### 3단계: 수동 테스트

```bash
# 메일/Teams 메시지 수집
node scripts/fetcher.mjs

# 데이터가 수집되었는지 확인
ls inbox/mail/           # .json 파일이 보여야 함
ls inbox/teams-chat/     # .json 파일이 보여야 함

# 일일 리포트 생성 (inbox에 데이터가 있어야 동작)
node scripts/processor.mjs

# 리포트 확인
ls daily/                # {날짜}.md 파일이 보여야 함
cat daily/$(date +%Y-%m-%d).md
```

### 4단계: 자동 스케줄링

OS에 맞는 방법을 선택하세요:

#### Linux (cron)

```bash
crontab -e
```

아래 내용을 추가하세요 (경로는 본인 환경에 맞게 수정):

```cron
# WorkStream KB - Fetcher: 30분마다 메일/Teams 수집
*/30 * * * * /usr/bin/node /path/to/workstream-kb/scripts/fetcher.mjs >> /path/to/workstream-kb/logs/fetcher-cron.log 2>&1

# WorkStream KB - Processor: 매일 07:00 일일 리포트 생성
0 7 * * * /usr/bin/node /path/to/workstream-kb/scripts/processor.mjs >> /path/to/workstream-kb/logs/processor-cron.log 2>&1
```

> **팁**: `which node`로 정확한 node 경로를 확인하세요. `logs/` 디렉토리를 먼저 생성하세요: `mkdir -p /path/to/workstream-kb/logs`

#### macOS (launchd)

```bash
# plist 파일 복사
cp config/com.kb.fetcher.plist ~/Library/LaunchAgents/
cp config/com.kb.processor.plist ~/Library/LaunchAgents/

# plist 파일에서 경로를 본인 환경에 맞게 수정한 후:
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.processor.plist
```

### 5단계: 리포트 확인

#### 방법 A: Docker (권장)

```bash
# 사이드바 먼저 생성
cd scripts && npm run sidebar && cd ..

# 뷰어 시작
docker compose up -d

# 브라우저에서 열기
open http://localhost:3939      # macOS
xdg-open http://localhost:3939  # Linux
```

#### 방법 B: 로컬 (npx serve)

```bash
cd scripts && npm run viewer
# http://localhost:3000 에서 열림
```

> **참고**: processor가 새 리포트를 생성한 후 `npm run sidebar`를 실행해야 사이드바 네비게이션이 업데이트됩니다.

### 6단계: Claude Code 슬래시 커맨드 (선택)

[Claude Code](https://docs.anthropic.com/en/docs/claude-code)를 사용하고 있다면, KB 전용 슬래시 커맨드를 설치할 수 있습니다:

```bash
mkdir -p ~/.claude/commands
cp config/kb-search.md config/kb-sync.md config/kb-status.md ~/.claude/commands/
```

| 명령어 | 설명 |
|--------|------|
| `/kb-search {키워드}` | 지식 베이스 검색 |
| `/kb-sync` | 수동 동기화 (fetcher + processor) |
| `/kb-status` | 동기화 상태 및 리포트 통계 |

---

## 설정 레퍼런스

모든 설정은 `.env` 파일에서 관리합니다. `.env.example` 참고.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `KB_ROOT` | `~/workstream-kb` | 프로젝트 루트 디렉토리 (절대 경로 또는 `~`) |
| `CLAUDE_CLI_PATH` | `/usr/local/bin/claude` | Claude CLI 바이너리 절대 경로 |
| `MY_DISPLAY_NAME` | `손성준` | 본인 표시 이름 (액션 아이템 분류용) |
| `MS365_CLIENT_ID` | `084a3e9f-...` | MS 365 MCP Server client ID (보통 변경 불필요) |
| `MS365_TOKEN_CACHE_PATH` | `~/.config/ms-365-mcp/.token-cache.json` | MSAL 토큰 캐시 경로 |
| `MS365_SELECTED_ACCOUNT_PATH` | `~/.config/ms-365-mcp/.selected-account.json` | 선택된 계정 경로 |
| `MS365_SCOPES` | `Mail.ReadWrite,...` | MS Graph API 스코프 |
| `MAIL_FETCH_LIMIT` | `50` | fetch 1회당 최대 메일 수 |
| `TEAMS_CHAT_LIMIT` | `30` | fetch 1회당 최대 Teams 채팅 수 |
| `TEAMS_MESSAGE_LIMIT` | `20` | 채팅당 최대 메시지 수 |
| `ATTACHMENT_MAX_SIZE_MB` | `10` | 이 크기 이상 첨부파일 건너뜀 |
| `INITIAL_FETCH_DAYS` | `7` | 첫 실행 시 며칠 전까지 가져올지 |
| `DATA_START_DATE` | `2026-02-01` | 이 날짜 이전 데이터 무시 |
| `ARCHIVE_AFTER_MONTHS` | `6` | N개월 지난 데이터를 `archive/`로 이동 |
| `CLAUDE_TIMEOUT_MS` | `180000` | Claude CLI 타임아웃 (밀리초) |

## 프로젝트 구조

```
workstream-kb/
├── scripts/
│   ├── package.json
│   ├── fetcher.mjs             # Layer 1: 데이터 수집 (AI 없음)
│   ├── processor.mjs           # Layer 2: 일일 리포트 생성
│   ├── archiver.mjs            # 아카이브
│   ├── generate-sidebar.mjs    # Docsify 사이드바 생성
│   ├── lib/
│   │   ├── config.mjs          # 중앙 설정 (.env)
│   │   ├── token-manager.mjs   # MSAL 토큰 관리
│   │   ├── graph-client.mjs    # MS Graph API 래퍼
│   │   ├── mail-fetcher.mjs    # 메일 수집 + HTML→Markdown + 첨부파일
│   │   ├── teams-fetcher.mjs   # Teams 채팅/채널 수집
│   │   ├── sync-state.mjs      # 동기화 상태 추적
│   │   ├── dedup.mjs           # 중복 제거
│   │   └── logger.mjs          # 파일/콘솔 로깅
│   └── prompts/
│       └── daily-report.md     # 리포트 생성 프롬프트 템플릿
├── config/                     # launchd plist, slash command
├── Dockerfile                  # nginx 기반 뷰어 컨테이너
├── docker-compose.yml          # Docker 뷰어 설정
├── nginx.conf                  # 첨부파일 다운로드 헤더
├── serve.json                  # npx serve 다운로드 헤더
├── index.html                  # Docsify SPA
├── .state/                     # 런타임 상태 (gitignored)
├── inbox/                      # 원시 JSON (gitignored)
├── daily/                      # 생성된 리포트 (gitignored)
│   └── attachments/            # 날짜별 메일 첨부파일
├── archive/                    # 오래된 리포트 (gitignored)
├── logs/                       # 로그 (gitignored)
└── index.json                  # 검색 인덱스 (gitignored)
```

## Docsify 뷰어

일일 리포트를 브라우저에서 열람할 수 있는 뷰어입니다.

**기능**: 사이드바 네비게이션, 전문 검색 (한국어 지원), 다크/라이트 테마 자동 전환, front-matter 숨김, 첨부파일 다운로드 링크.

**Docker** (nginx, 안정적인 파일 다운로드 권장):
```bash
# 사이드바 생성 후 실행
cd scripts && npm run sidebar && cd ..
docker compose up -d    # http://localhost:3939
```

**로컬** (npx serve):
```bash
cd scripts && npm run viewer    # http://localhost:3000
```

## 커스터마이징

### 리포트 프롬프트

`scripts/prompts/daily-report.md`를 수정하여 리포트 형식, 섹션, AI 지시사항을 변경할 수 있습니다.

### 스케줄

- **Fetcher 주기**: cron 스케줄 수정 (기본: `*/30 * * * *` = 30분마다)
- **Processor 시각**: cron 스케줄 수정 (기본: `0 7 * * *` = 매일 07:00)
- **macOS**: plist 파일의 `StartInterval` / `Hour`+`Minute` 수정

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `ENOENT: .token-cache.json` | MS365 MCP Server 미설정 | [MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server) 설치 및 로그인 |
| 인증 에러 (exit code 2) | MS365 토큰 만료 | MS365 MCP Server에서 재로그인 |
| fetch 후 inbox가 비어있음 | 동기화 상태 문제 또는 새 메시지 없음 | `.state/sync-state.json` 삭제 후 재시도 |
| `claude: command not found` | Claude CLI 미설치 또는 경로 오류 | Claude Code CLI 설치, `.env`에 `CLAUDE_CLI_PATH` 설정 |
| Processor 타임아웃 | 메시지 과다 또는 모델 느림 | `.env`에서 `CLAUDE_TIMEOUT_MS` 증가 (기본: 180000 = 3분) |
| 리포트 생성 실패 시 데이터 유실? | Claude CLI 에러 | 실패 시 inbox 자동 보존, `node scripts/processor.mjs` 재실행 |
| Docker 뷰어 빈 화면 | 사이드바 미생성 | `cd scripts && npm run sidebar` 먼저 실행 |
| Docker에서 첨부파일 다운로드 안 됨 | nginx 설정 또는 volume 문제 | `docker-compose.yml`의 `daily/` volume 마운트 확인 |
| 오래된 데이터를 가져옴 | `DATA_START_DATE` 미설정 | `.env`에 `DATA_START_DATE`를 원하는 시작일로 설정 |

### 로그 확인

```bash
# Fetcher 로그
tail -f logs/fetcher-cron.log

# Processor 로그 (날짜별)
ls logs/                         # 오늘 로그 파일 확인
tail -f logs/$(date +%Y-%m-%d).log

# 동기화 상태
cat .state/sync-state.json
```

## 라이선스

MIT
