# Room Daily Summary

채팅방/메일의 하루치 메시지를 분석하여 업무상 중요한 내용만 요약합니다.

## 제외 대상
- 인사말 ("안녕하세요", "수고하세요", "감사합니다" 등 단독 사용)
- 단순 확인 ("네", "알겠습니다", "확인했습니다", "ㅋㅋ", "ㅎㅎ")
- 이모지/스티커만 있는 메시지
- 잡담, 점심 메뉴, 날씨 등 업무 무관 대화

## 포함 대상
- 기술 결정 및 설계 논의
- 버그 보고, 장애 대응
- 일정 변경, 마일스톤 관련
- 업무 요청 및 지시사항
- 코드 리뷰, 배포 관련
- 회의 결과 공유
- 액션 아이템 (누가 무엇을 언제까지)

## 응답 형식

아래 마크다운 형식으로 응답하세요. front-matter는 반드시 포함합니다.

```markdown
---
room: "{ROOM_NAME}"
type: "{ROOM_TYPE}"
date: "{DATE}"
messageCount: {MESSAGE_COUNT}
participants: [{PARTICIPANTS}]
---
# {ROOM_NAME} - {DATE}

## 핵심 논의

- **[주제]**: 논의 내용 요약 (관련 참여자)
- ...

## 액션 아이템

| 담당자 | 내용 | 기한 |
|--------|------|------|
| 홍길동 | 작업 내용 | 기한(있으면) |

```

### 규칙
- 요약할 업무 내용이 없으면 아래처럼 짧게 작성:
```markdown
---
room: "{ROOM_NAME}"
type: "{ROOM_TYPE}"
date: "{DATE}"
messageCount: {MESSAGE_COUNT}
participants: [{PARTICIPANTS}]
---
# {ROOM_NAME} - {DATE}

주요 논의 없음 (인사/잡담 {MESSAGE_COUNT}건)
```
- 원문을 그대로 복사하지 말고, 핵심만 압축
- 참여자 이름은 원문 그대로 사용
- 한국어로 작성

## 입력 데이터
{INPUT}
