# Google Ad Manager + IMA 보상형 광고(Rewarded) 연동 가이드

이 문서는 REFN 프로젝트(웹 브라우저용)에 보상형 광고를 연동하는 방법을 단계별로 정리합니다.

요약:
- 웹에서는 AdMob이 아닌 Google Ad Manager(GAM) + IMA SDK 또는 IMA를 통해 제공되는 VAST를 사용해 보상형(Rewarded) 광고를 구현하세요.
- 광고 완료를 신뢰하려면 서버 측 검증(광고 네트워크의 검증 토큰/서명 사용)을 권장합니다.

---

## 1. 큰 그림
1. 페이지에서 IMA SDK를 로드
2. 보상형 광고 슬롯을 생성하고 요청
3. 광고가 성공적으로 재생 완료되면 클라이언트는 서버로 보상(크레딧 지급) 요청을 보냅니다
  - 권장 안전 흐름: 클라이언트는 광고 시작 이전에 `/api/ad-session`로 서버에서 고유한 sessionId를 받아 광고 요청(cust_params)에 포함합니다. 광고 재생/완료 정보와 sessionId를 `/api/earn-credits`로 제출하면, 서버는 세션을 조회하여 재사용/만료를 방지하고 네트워크 검증(가능한 경우)을 수행한 뒤 크레딧을 지급합니다.
4. 서버는 광고 네트워크가 제공하는 검증 데이터(signature / event token 등)을 확인하거나 자체 로그/정책에 따라 지급을 허용

> 참고: Ad Manager/Google의 상위 흐름은 광고 단위 및 인벤토리 설정이 필요합니다. GAM에서 Rewarded 형식의 광고 단위를 생성하세요.

---

## 2. 클라이언트(브라우저) 예시
### 2.1 IMA 및 GPT 스크립트 로드
```html
<!-- IMA SDK for HTML5 (Google의 문서에 따라 변경될 수 있음) -->
<script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"></script>

<!-- GPT (선택적으로) -->
<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
```

### 2.2 간단한 IMA 보상형 광고 로드 로직 (개념 예시)
- 이 코드는 실제 서비스로 옮기기 전에 IMA 문서를 참고해 테스트 광고 ID로 충분히 확인해야 합니다.

```javascript
// 간단한 예시 - 실제 환경에서는 오류/콜백 처리, 타임아웃 및 재시도 로직 필요
async function loadWebRewardedAd() {
  return new Promise((resolve) => {
    // IMA 객체/Player 초기화는 페이지에서 미리 수행
    // 여기서는 pseudo-code 수준으로 작성합니다.

    // adDisplayContainer, AdsLoader, AdsRequest 등 생성 및 초기화
    // adsLoader.requestAds(adsRequest) -> adsManager init / start

    // adsManager.addEventListener(ADS_COMPLETED, () => resolve({ completed: true, details: { /* ... */ } }))
    // adsManager.addEventListener(ADS_ERROR, () => resolve({ completed: false }))

    // 테스트용 간단한 fallback: 바로 완료 처리
    resolve({ completed: true });
  });
}

// credits.js 쪽에서 window.loadWebRewardedAd를 호출합니다.

// 추가 권장 흐름(REFN 예시):
// 1) 클라이언트가 /api/ad-session (POST) 호출하여 sessionId 획득
// 2) loadWebRewardedAd 호출 시 options.extraParams.sessionId에 전달 -> adTagUrl에 cust_params=session_id=<sessionId>로 붙여 요청
// 3) 광고 완료 시 클라이언트가 /api/earn-credits POST로 { sessionId, verification } 전송
// 4) 서버는 ad_sessions 테이블에서 세션 조회 후 사용여부/만료 확인, (가능하면 광고 네트워크 검증), 지급
window.loadWebRewardedAd = loadWebRewardedAd;
```

> 실제 운영에서는 IMA에서 광고 완료 시점에 callback을 통해 광고 네트워크가 제공하는 검증 데이터(있다면)를 받아 서버로 전달하세요.

---

## 3. 보안: 서버 측 검증(권장)
1. 광고 완료 시 광고 네트워크가 제공하는 `verification token` 또는 서명을 받을 수 있다면 클라이언트에서 받은 토큰을 그대로 서버로 전송.
2. 서버에서 네트워크 엔드포인트(또는 제공 가이드)를 통해 토큰을 확인하거나 내부 정책(클릭/뷰 로그)으로 지급 여부 결정.
3. 지급이 확인되면 서버는 사용자 크레딧을 증가시키는 트랜잭션을 실행합니다.

> 예시: 앱용 AdMob에서는 Google Play 서비스로 verification을 제공하거나 mediation 플랫폼의 server-side verification을 사용합니다. 웹에서도 광고 네트워크별 verification flow를 따르세요.

---

## 4. 테스트 가이드
- 항상 테스트 광고 ID 또는 테스트 모드를 사용해서 여러 브라우저 및 모바일 환경에서 동작 확인
- 광고가 로드되지 않는 경우(AdBlock 등) UX 대비 필요(광고 불가 시 대체 보상/메시지 제공)

---

## 5. 마이그레이션 포인트(REFN 프로젝트)
1. `js/credits.js`의 `handleWatchAd()`는 `window.loadWebRewardedAd()`를 우선 호출하도록 변경했습니다.
2. `window.admobRewarded`는 앱(webview)용 네이티브 브리지 백워드 호환으로 유지하지만, 웹 전용은 위 IMA 로직으로 교체하세요.
3. 서버(`POST /api/earn-credits`)는 광고 검증 토큰을 수용하도록 확장하세요.

### DB 테이블: ad_sessions (예시)
보상형 광고의 서버 검증을 위해 간단한 `ad_sessions` 테이블을 만들어 세션을 관리하세요.

예시 Postgres CREATE TABLE:

```sql
CREATE TABLE ad_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  ad_network varchar,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  used boolean DEFAULT false,
  used_at timestamptz,
  verification jsonb
);
```

이 테이블을 사용하면 클라이언트가 `/api/ad-session`으로 sessionId를 받고 광고를 요청한 뒤, 광고 완료 시 `/api/earn-credits`로 해당 sessionId를 제출하여 서버에서 세션 사용 여부/만료 등을 검사한 후 지급을 진행할 수 있습니다.

---

원하시면 제가 IMA를 이용한 구체적인 샘플 구현(페이지 레벨 코드/광고 요청/AdsManager 이벤트 처리)을 `js/` 코드로 직접 추가해 드리겠습니다. 어떤 부분을 먼저 원하시나요?
- [ ] 클라이언트 IMA 샘플 구현 (loadWebRewardedAd 실제 동작 예시)
- [ ] 서버 검증 엔드포인트 샘플 (supabase 또는 express 예시)
- [ ] 통합 테스트 시나리오 / Playwright 테스트 샘플
