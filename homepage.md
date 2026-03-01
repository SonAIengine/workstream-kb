# WorkStream KB

업무 커뮤니케이션(메일, Teams)을 자동 수집하고 AI로 채팅방별 일일 요약을 생성하여 검색 가능한 지식 베이스.

## 채팅방 바로가기

| 구분 | 바로가기 |
|------|----------|
| Teams 채팅 | [rooms/teams-chat/](rooms/teams-chat/) |
| Teams 채널 | [rooms/teams-channel/](rooms/teams-channel/) |
| 메일 | [rooms/mail/](rooms/mail/) |

## 바로가기

- **일일 다이제스트**: 사이드바의 "Daily" 섹션
- **검색**: 왼쪽 상단 검색창 (Ctrl+K)
- **아카이브**: 사이드바의 "Archive" 섹션

## 사용 안내

```bash
cd ~/workstream-kb/scripts
npm run viewer      # 사이드바 생성 + localhost:3000 시작
npm run sidebar     # 사이드바만 재생성
```

> 사이드바는 `scripts/generate-sidebar.mjs`로 자동 생성됩니다. 새 문서 추가 후 `npm run sidebar`를 실행하면 반영됩니다.
