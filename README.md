# iknowur MVP

iknowur MVP는 아래 흐름을 구현합니다.

1. 파티 생성/참가
2. 각 멤버가 예측 5개를 암호화 + 해시 커밋으로 제출
3. 전원 제출 시 파티 활성화
4. 예측 작성자가 Claim 등록(원문 + salt 공개)
5. 서버가 커밋 해시 검증
6. 나머지 멤버 과반 투표로 승인/거절
7. 점수 반영 (승인 +1 / 거절 -1)

## 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속

## 라우트

- `/` : 게임 허브 홈 (iknowur / gussmymbti 버튼)
- `/iknowur` : iknowur 게임
- `/gussmymbti` : gussmymbti 빌드 앱

## 모바일 UX 포인트

- 모바일 우선 레이아웃
- 탭 기반 화면 전환(상태/예측/클레임/로그)
- 파티 코드 복사, 파티 나가기 버튼
- 제출/투표 진행 중 버튼 잠금
- 하단 토스트 알림

## MVP 규칙

- 예측 제출은 멤버당 정확히 5개
- 제출 후 수정 불가
- 예측 1개는 한 번만 Claim 가능
- Claim은 작성자 본인만 가능
- Claimant 제외 나머지 인원의 과반 찬성 시 승인

## 보안/무결성 포인트

- 서버 저장: `ciphertext`, `iv`, `commitHash`
- 클레임 시 `revealedText + salt` 재해시로 검증
- 해시 불일치면 클레임 거부

## 데이터 저장

- 서버는 `data/store.json`에 상태를 저장합니다.
