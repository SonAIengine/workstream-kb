# WorkStream KB

## Architecture

2-Layer 하이브리드 시스템:
- **Layer 1 (Fetcher)**: 30분마다 MS Graph API로 메일/Teams 수집 → `inbox/` JSON 저장 (AI 비용 없음)
- **Layer 2 (Processor)**: 매일 07:00 Claude CLI로 채팅방별 일일 요약 → `rooms/{type}/{slug}/{date}.md` + `daily/` digest + `index.json`
- **Archiver**: `ARCHIVE_AFTER_MONTHS` 이전 데이터를 `archive/`로 이동

## Directory Structure

```
workstream-kb/
├── scripts/
│   ├── fetcher.mjs          # Layer 1 진입점
│   ├── processor.mjs        # Layer 2 진입점
│   ├── archiver.mjs         # 데이터 아카이브
│   ├── lib/
│   │   ├── config.mjs       # 중앙 설정 (.env 기반)
│   │   ├── token-manager.mjs
│   │   ├── graph-client.mjs
│   │   ├── mail-fetcher.mjs
│   │   ├── teams-fetcher.mjs
│   │   ├── sync-state.mjs
│   │   ├── dedup.mjs
│   │   └── logger.mjs
│   └── prompts/             # Claude CLI 프롬프트 템플릿
├── config/                  # launchd plist, slash commands
├── .state/                  # sync-state, processed-ids (gitignored)
├── inbox/                   # raw JSON staging (gitignored)
├── rooms/                   # 채팅방별 일일 요약 Markdown (gitignored)
│   ├── teams-chat/{slug}/   # Teams 채팅방 요약
│   ├── teams-channel/{slug}/ # Teams 채널 요약
│   ├── mail/                # 메일 일별 요약
│   └── _room-map.json       # chatId → slug 캐시
├── archive/                 # 6개월 이후 아카이브 (gitignored)
├── daily/                   # 일일 다이제스트 (gitignored)
├── index.json               # 검색 인덱스 (gitignored)
└── .env                     # 환경 설정 (gitignored, .env.example 참조)
```

## Code Conventions

- ES modules (import/export), Node.js 20+
- `scripts/lib/config.mjs`에서 모든 설정 중앙 관리 — 하드코딩 금지
- Atomic file write 패턴: tmpPath에 쓰고 renameSync
- 개별 항목 실패는 전체를 중단하지 않음 (graceful degradation)

## Key Config (config.mjs)

| Export | 용도 |
|--------|------|
| `DATA_START_DATE` | 데이터 수집 시작일 (이전 데이터 fetch 차단) |
| `ARCHIVE_AFTER_MONTHS` | N개월 후 archive/ 이동 |
| `INITIAL_FETCH_DAYS` | 첫 실행 시 며칠 전까지 fetch |
| `KB_ROOT` | workstream-kb 루트 경로 |
| `ROOMS_DIR` | 채팅방 요약 저장 디렉토리 |
| `ROOM_MAP_FILE` | chatId → slug 매핑 캐시 |
| `MY_DISPLAY_NAME` | 1:1 DM 식별용 내 표시 이름 |

## Retention Policy

- fetcher는 `DATA_START_DATE` (기본 2026-02-01) 이전 데이터를 가져오지 않음
- `ARCHIVE_AFTER_MONTHS` (기본 6) 개월 지난 데이터는 `archive/`로 이동
- `index.json` 경로는 archiver가 자동 업데이트

## Run Commands

```bash
cd scripts && npm install          # 의존성 설치
node scripts/fetcher.mjs           # 메일/Teams 수집
node scripts/processor.mjs         # 채팅방별 일일 요약 생성
node scripts/archiver.mjs          # 아카이브 실행
```

## Docsify Viewer

KB 문서를 브라우저에서 확인할 수 있는 로컬 뷰어:

```bash
cd scripts && npm run viewer   # localhost:3000 시작
cd scripts && npm run sidebar  # _sidebar.md만 재생성
```

- `index.html`: Docsify SPA (CDN 로드, 빌드 불필요)
- `_sidebar.md`: `scripts/generate-sidebar.mjs`로 자동 생성 (gitignored)
- 검색 플러그인 내장, front-matter 자동 숨김, 다크/라이트 테마 지원

## Token / Auth

MS365 MCP Server (`~/.config/ms-365-mcp/`)의 토큰 캐시를 공유. 별도 OAuth 불필요.
