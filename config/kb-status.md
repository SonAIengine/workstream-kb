# 지식 베이스 상태 (KB Status)

지식 베이스의 현재 상태와 통계를 표시합니다.

## 실행 순서

### 1단계: 상태 파일 로드
- `~/workstream-kb/.state/sync-state.json` 읽기
- `~/workstream-kb/index.json` 읽기

### 2단계: 디렉토리 통계 수집
Bash로 각 디렉토리의 파일 수 확인:
- `find ~/workstream-kb/inbox/mail -name "*.json" 2>/dev/null | wc -l`
- `find ~/workstream-kb/inbox/teams-chat -name "*.json" 2>/dev/null | wc -l`
- `find ~/workstream-kb/inbox/teams-channel -name "*.json" 2>/dev/null | wc -l`
- 각 rooms/{type}/{slug}/ 디렉토리의 .md 파일 수

### 3단계: 결과 출력

## 지식 베이스 상태

### 동기화 정보
| 항목 | 마지막 동기화 | 수집 건수 |
|------|-------------|----------|
| 메일 | {datetime} | {count}건 |
| Teams 채팅 | {datetime} | {count}건 |
| Teams 채널 | {datetime} | {count}건 |
| Processor | {datetime} | {count}건 |

### 대기 중 (inbox)
- 메일: N건
- Teams 채팅: N건
- Teams 채널: N건

### 채팅방별 요약 수
| 유형 | 채팅방 수 | 요약 문서 수 | 최근 업데이트 |
|------|----------|-------------|-------------|
| Teams 채팅 | N개 | M건 | {date} |
| Teams 채널 | N개 | M건 | {date} |
| 메일 | N개 | M건 | {date} |

### 인덱스
- 총 항목: N건
- 마지막 업데이트: {datetime}

### 스케줄
- Fetcher: 30분 간격 (launchd)
- Processor: 매일 07:00 (launchd)
