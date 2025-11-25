# Paddle 연동 가이드 (구독/결제)

이 문서는 REFN 프로젝트에서 Paddle을 이용해 구독(또는 결제) 흐름을 연결하는 방법을 설명합니다.

> **중요**: 절대로 API 키를 코드(커밋)에 직접 넣지 마세요. 비밀 키는 `.env` 또는 CI 비밀 환경변수에 넣어 사용하세요.

## 1) 준비 사항
- Paddle 계정에서 Vendor ID, Vendor Auth Code(또는 API key)를 확보하세요.
- 각 요금제(플랜)에 해당하는 `product_id` 또는 `plan_id`를 Paddle 관리자에서 확인하세요.
- REFN 프로젝트의 `plans` 테이블에 각 plan 레코드의 `features` JSON 필드에 아래 항목을 넣어두면 서버에서 자동으로 처리합니다:
  - `paddle_product_id`: (예: 123456) 또는
  - `paddle_link`: 직접 호스팅된 checkout 링크가 있으면 (string)

예) plans.features 예시
```json
{
  "is_one_time": false,
  "paddle_product_id": 123456
}
```

## 2) 서버 환경 변수 설정
서버가 Paddle API 호출을 하려면 다음 환경변수를 설정하세요 (.env 파일 또는 배포 환경 변수):
- `PADDLE_VENDOR_ID` — Paddle에서 발급된 vendor id
- `PADDLE_VENDOR_AUTH_CODE` — Paddle의 vendor auth code (비밀값)

**예 (.env)**
```
PADDLE_VENDOR_ID=123456
PADDLE_VENDOR_AUTH_CODE=live_xxxxyyyyzzzz
```

## 3) 플로우 개요
1. 프론트엔드 `handleBuyPlan(planCode)` 호출 → `/api/buy-plan`로 planCode 전송
2. 서버 `/api/buy-plan`는 plans 테이블에서 플랜을 조회
   - `features.paddle_link`가 있으면 그 링크를 바로 반환
   - `features.paddle_product_id`가 있으면 Paddle `generate_pay_link` 엔드포인트를 호출해 결제 링크 생성
3. 서버가 반환한 `checkoutUrl`로 클라이언트를 리다이렉트하여 Paddle Checkout UI에서 결제를 진행
4. 결제 완료/웹훅 → 서버에서 처리(권장)

## 4) 보안/운영 권장사항
- 결제 완료는 반드시 서버에서 webhook(또는 Paddle의 server-side API)을 통해 검증 후 사용자 계정에 권한/크레딧을 부여하세요.
- `passthrough` 필드를 사용해 구매 시 사용자 ID/planCode를 함께 전달하면 webhook에서 쉽게 매핑할 수 있습니다.
- 로컬 개발 환경에서 Paddle을 테스트하려면 Paddle에서 제공하는 테스트 product / sandbox 설정을 사용하세요.

## 5) REFN 프로젝트에서 이미 지원한 부분
- `/api/buy-plan` 구현이 Paddle generate_pay_link 호출을 시도하도록 업데이트되었습니다.
  - 이를 사용하려면 `plans.features.paddle_product_id`에 Paddle 상품 ID를 넣고 환경변수 `PADDLE_VENDOR_ID`, `PADDLE_VENDOR_AUTH_CODE`를 설정하세요.
  - `paddle_link`가 직접 있으면 서버는 그 링크를 우선 반환합니다.

---

도움이 필요하면 제가 다음을 도와드릴 수 있습니다:
- plans 테이블에 paddle_product_id 추가/마이그레이션 SQL 생성
- Paddle webhook 핸들러(구매 완료 → user 크레딧 지급) 서버 루틴 추가
- 테스트용 Paddle product/sample 설정 가이드
