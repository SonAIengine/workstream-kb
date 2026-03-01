# WorkStream KB

> **[English Documentation](README.md)**

업무 커뮤니케이션(메일, Teams 채팅, Teams 채널)을 자동 수집하고, AI가 하루 종합 업무 리포트를 생성하여 검색 가능한 개인 지식 베이스를 구축하는 시스템.

## 왜 만들었나

여러 프로젝트를 동시에 진행하면서 매일 수십 개의 메일과 Teams 메시지를 받다 보면, "2주 전에 누가 뭐라고 했더라?"를 찾는 게 고통이 됩니다. 중요한 의사결정은 채팅 스레드에 묻히고, 액션 아이템은 잊히고, 기술 디테일은 사라집니다.

## 어떻게 해결하나

WorkStream KB는 하루의 커뮤니케이션을 자동으로 수집하여 **하루 1개 종합 리포트**로 정리합니다. 의사결정, 액션 아이템, 프로젝트 현황, 기술 메모, 일정까지 한 문서에서 파악 가능합니다.

### 리포트 예시

```markdown
## 핵심 요약
- **제주은행 GenAI 플랫폼 구축** 본격 착수 — 요구사항 취합 미팅 월요일 10시부터 매일 진행,
  단 고객사가 일정 대폭 앞당김 요청(4월 가오픈/7월 공식오픈)

## 오늘의 의사결정
- **[XGEN 문서관리]** 리스트 조회를 qdrant → PostgreSQL로 전환 — 3초→0.1초 개선

## 액션 아이템
| 내용 | 배경/맥락 | 요청자 | 기한 |
|------|-----------|--------|------|
| 확대경영회의 자료 초안 작성 | 분기 보고용 | 정우문 | 화 오전 |

## 프로젝트별 현황: 제주은행
> "고객사에서 일정을 아주 많이 앞당겨 달라고 요청하였습니다..." — 김대현 PM
...
```

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

## 사전 요구사항

- **Node.js 20+** (nvm 권장)
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** (구독 필요)
- **[MS 365 MCP Server](https://github.com/softeria-eu/ms-365-mcp-server)** 설정 및 로그인 완료
- **macOS** (launchd 스케줄링), Linux는 cron/systemd로 대체 가능

## 빠른 시작

### 1. 설치

```bash
git clone https://github.com/SonAIengine/workstream-kb.git
cd workstream-kb/scripts && npm install
```

### 2. 환경 설정

```bash
cp .env.example .env
# .env 파일 편집
```

### 3. MS365 토큰 확인

```bash
ls ~/.config/ms-365-mcp/.token-cache.json
ls ~/.config/ms-365-mcp/.selected-account.json
```

### 4. 수동 실행

```bash
node scripts/fetcher.mjs      # 메일/Teams 수집
node scripts/processor.mjs     # 일일 리포트 생성
```

### 5. 리포트 확인

```bash
# 방법 A: Docker (권장)
docker-compose up -d
open http://localhost:3939

# 방법 B: 로컬
cd scripts && npm run viewer
open http://localhost:3000
```

### 6. 자동화 (macOS launchd)

```bash
cp config/com.kb.fetcher.plist ~/Library/LaunchAgents/
cp config/com.kb.processor.plist ~/Library/LaunchAgents/
# plist 파일에서 경로 수정 후:
launchctl load ~/Library/LaunchAgents/com.kb.fetcher.plist
launchctl load ~/Library/LaunchAgents/com.kb.processor.plist
```

### 7. Claude Code slash command (선택)

```bash
mkdir -p ~/.claude/commands
cp config/kb-search.md config/kb-sync.md config/kb-status.md ~/.claude/commands/
```

| 명령어 | 설명 |
|--------|------|
| `/kb-search {키워드}` | 지식 베이스 검색 |
| `/kb-sync` | 수동 동기화 (fetcher + processor) |
| `/kb-status` | 동기화 상태 및 리포트 통계 |

## 설정

모든 설정은 `.env` 파일에서 관리합니다. `.env.example` 참고.

| 카테고리 | 주요 변수 |
|----------|-----------|
| **인증** | `MS365_CLIENT_ID`, `MS365_TOKEN_CACHE_PATH` |
| **경로** | `KB_ROOT`, `CLAUDE_CLI_PATH` |
| **Fetcher** | `MAIL_FETCH_LIMIT` (50), `TEAMS_CHAT_LIMIT` (30), `ATTACHMENT_MAX_SIZE_MB` (10) |
| **Processor** | `CLAUDE_TIMEOUT_MS` (900000), `MY_DISPLAY_NAME` |
| **보관 정책** | `DATA_START_DATE`, `ARCHIVE_AFTER_MONTHS` (6) |

## Docsify 뷰어

일일 리포트를 브라우저에서 열람할 수 있는 뷰어입니다.

**기능**: 사이드바 네비게이션, 전문 검색 (한국어 지원), 다크/라이트 테마 자동 전환, front-matter 숨김, 첨부파일 다운로드 링크.

**Docker** (nginx, 안정적인 파일 다운로드 권장):
```bash
docker-compose up -d    # http://localhost:3939
```

**로컬** (npx serve):
```bash
cd scripts && npm run viewer    # http://localhost:3000
```

## 커스터마이징

### 리포트 프롬프트

`scripts/prompts/daily-report.md`를 수정하여 리포트 형식, 섹션, AI 지시사항을 변경할 수 있습니다.

### 스케줄

- **Fetcher 주기**: `com.kb.fetcher.plist`의 `StartInterval` (초 단위, 기본 1800 = 30분)
- **Processor 시각**: `com.kb.processor.plist`의 `Hour`/`Minute` (기본 07:00)

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 인증 에러 (exit code 2) | MS365 토큰 만료 | MS365 MCP Server에서 재로그인 |
| fetch 후 inbox가 비어있음 | 동기화 상태 문제 | `.state/sync-state.json` 확인 |
| Processor 타임아웃 | 메시지 과다 / 모델 느림 | `.env`에서 `CLAUDE_TIMEOUT_MS` 증가 |
| 리포트 생성 실패 시 데이터 유실 | Claude CLI 에러 | 실패 시 inbox 자동 보존, processor 재실행 |
| 첨부파일 다운로드 멈춤 | Docker/Colima 네트워크 | 로컬 serve 사용 또는 `/etc/hosts`에 `::1 kb.local` 추가 |

## Linux 환경

macOS launchd 대신 cron 사용:

```bash
crontab -e
# Fetcher: 30분마다
*/30 * * * * /path/to/node /path/to/scripts/fetcher.mjs >> /path/to/logs/fetcher.log 2>&1
# Processor: 매일 07:00
0 7 * * * /path/to/node /path/to/scripts/processor.mjs >> /path/to/logs/processor.log 2>&1
```

## 라이선스

MIT
