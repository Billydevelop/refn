// js/credits.js

let creditConfig = null;
let paddleSdkPromiseV1 = null;
let paddleSdkPromiseV2 = null;
let paddleSetupVendor = null;
let paddleSetupEnv = null;
let paddleSetupToken = null;

async function buildAuthHeaders() {
  if (!window.sb) return { 'Content-Type': 'application/json' };
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function loadCreditConfig() {
  try {
    const res = await fetch('/api/credit-config');
    const json = await res.json();
    if (!json.success) return;
    creditConfig = json;
    renderCreditUpsell();
  } catch (e) {
    console.error('loadCreditConfig error', e);
  }
}

async function openCreditUpsell() {
  // ensure the upsell partial exists in DOM before trying to show it
  let modal = document.getElementById('creditUpsellModal');

  if (!modal) {
    try {
      if (typeof window.loadCreditUpsellPartial === 'function') {
        await window.loadCreditUpsellPartial();
      } else {
        // fallback: try to fetch and insert directly
        const res = await fetch('./partials/credit-upsell.html');
        if (res.ok) {
          const html = await res.text();
          document.body.insertAdjacentHTML('beforeend', html);
        }
      }
    } catch (e) {
      console.error('failed to load credit-upsell partial', e);
    }

    modal = document.getElementById('creditUpsellModal');

    // If it's still not in DOM, give up
    if (!modal) return;

    // Attach necessary event handlers if they aren't already attached
    try {
      const closeBtn = document.querySelector('[data-credit-upsell-close]');
      if (closeBtn && !closeBtn._cuCloseBound) {
        closeBtn.addEventListener('click', closeCreditUpsell);
        closeBtn._cuCloseBound = true;
      }

      const watchAdBtn = document.getElementById('cuWatchAdBtn');
      if (watchAdBtn && !watchAdBtn._cuWatchBound) {
        watchAdBtn.addEventListener('click', handleWatchAd);
        watchAdBtn._cuWatchBound = true;
      }

      // backdrop click (클릭이 모달 바깥이면 닫기)
      const modalEl = document.getElementById('creditUpsellModal');
      if (modalEl && !modalEl._cuBackdropBound) {
        modalEl.addEventListener('click', (e) => {
          if (e.target === modalEl) closeCreditUpsell();
        });
        modalEl._cuBackdropBound = true;
      }

      // render UI if config is present
      renderCreditUpsell();
    } catch (e) {
      console.error('failed to bind credit-upsell handlers', e);
    }
  }

  modal.classList.remove('hidden');
}

function closeCreditUpsell() {
  const modal = document.getElementById('creditUpsellModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function renderCreditUpsell() {
  if (!creditConfig) return;
  const plans = creditConfig.plans || [];
  const adReward = creditConfig.adReward;

  const subArea = document.getElementById('cuSubscriptionArea');
  const packArea = document.getElementById('cuPackArea');
  const adDesc = document.getElementById('cuAdDesc');

  if (adDesc && adReward) {
    adDesc.textContent = `광고 1회 시청 시 ${adReward.credits} 크레딧 지급 (하루 최대 ${adReward.maxPerDay}회)`;
  }

  if (!subArea || !packArea) return;
  subArea.innerHTML = '';
  packArea.innerHTML = '';

  plans.forEach(p => {
    const features = p.features || {};
    const item = document.createElement('div');
    item.className = 'cu-list-item';
    item.dataset.planCode = p.code;
    item.innerHTML = `
      <div class="cu-item-name">${p.name}</div>
      <div class="cu-item-desc">${p.description || ''}</div>
      <div class="cu-item-price">${p.price_cents.toLocaleString('ko-KR')}원</div>
    `;
    item.addEventListener('click', () => handleBuyPlan(p.code));

    if (features.is_one_time) {
      packArea.appendChild(item);
    } else {
      subArea.appendChild(item);
    }
  });
}

function setupPaddleInstance(paddle, options = {}) {
  if (!paddle) return null;

  const env =
    options.environment ||
    creditConfig?.paddleEnv ||
    creditConfig?.paddleEnvironment ||
    null;
  const vendorId =
    options.vendorId ||
    creditConfig?.paddleVendorId ||
    creditConfig?.paddleVendorID ||
    creditConfig?.paddleVendor;
  const clientToken =
    options.clientToken ||
    creditConfig?.paddleClientToken ||
    creditConfig?.paddleClient ||
    null;
  const sellerId =
    options.sellerId ||
    creditConfig?.paddleSellerId ||
    null;

  if (env && env.toLowerCase() === 'sandbox' && paddle.Environment?.set) {
    try {
      paddle.Environment.set('sandbox');
      paddleSetupEnv = 'sandbox';
    } catch (e) {
      console.warn('Paddle sandbox setup failed', e);
    }
  }

  if (clientToken && paddleSetupToken !== clientToken && typeof paddle.Setup === 'function') {
    try {
      const setupParams = { token: clientToken };
      if (sellerId) setupParams.seller = sellerId;
      paddle.Setup(setupParams);
      paddleSetupToken = clientToken;
      paddleSetupVendor = null;
    } catch (e) {
      console.warn('Paddle token setup failed', e);
    }
  } else if (!clientToken && vendorId && paddleSetupVendor !== vendorId && typeof paddle.Setup === 'function') {
    try {
      paddle.Setup({ vendor: vendorId });
      paddleSetupVendor = vendorId;
      paddleSetupToken = null;
    } catch (e) {
      console.warn('Paddle setup failed', e);
    }
  }

  return paddle;
}

async function ensurePaddleSdkLoaded(options = {}) {
  if (window.Paddle && window.Paddle.Checkout) {
    return setupPaddleInstance(window.Paddle, options);
  }

  const useV2 = !!options.clientToken;
  const sdkSrc = useV2
    ? 'https://cdn.paddle.com/paddle/v2/paddle.js'
    : 'https://cdn.paddle.com/paddle/paddle.js';
  const promiseRef = useV2 ? 'paddleSdkPromiseV2' : 'paddleSdkPromiseV1';

  if (useV2 && paddleSdkPromiseV2) return paddleSdkPromiseV2;
  if (!useV2 && paddleSdkPromiseV1) return paddleSdkPromiseV1;

  const loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-paddle-sdk="${useV2 ? 'v2' : 'v1'}"]`);
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.Paddle) {
          resolve(setupPaddleInstance(window.Paddle, options));
        } else {
          reject(new Error('Paddle SDK failed to load'));
        }
      });
      existing.addEventListener('error', () => reject(new Error('Paddle SDK failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.src = sdkSrc;
    script.async = true;
    script.dataset.paddleSdk = useV2 ? 'v2' : 'v1';
    script.onload = () => {
      if (window.Paddle) {
        resolve(setupPaddleInstance(window.Paddle, options));
      } else {
        reject(new Error('Paddle SDK missing after load'));
      }
    };
    script.onerror = () => reject(new Error('Paddle SDK failed to load'));
    document.head.appendChild(script);
  });

  if (useV2) {
    paddleSdkPromiseV2 = loaderPromise;
  } else {
    paddleSdkPromiseV1 = loaderPromise;
  }

  return loaderPromise;
}

async function openPaddleCheckoutUrl(checkoutUrl) {
  if (!checkoutUrl) return false;

  try {
    const paddle = await ensurePaddleSdkLoaded();
    if (!paddle || !paddle.Checkout || typeof paddle.Checkout.open !== 'function') {
      return false;
    }

    paddle.Checkout.open({
      override: checkoutUrl,
      method: 'overlay',
      locale: 'ko'
    });

    return true;
  } catch (e) {
    console.warn('Paddle checkout overlay failed, falling back to redirect', e);
    return false;
  }
}

async function openPaddleCheckoutWithPrice(priceId, clientToken, environment, sellerId) {
  if (!priceId || !clientToken) return false;

  try {
    const paddle = await ensurePaddleSdkLoaded({ clientToken, environment, sellerId });
    if (!paddle || !paddle.Checkout || typeof paddle.Checkout.open !== 'function') {
      return false;
    }

    paddle.Checkout.open({
      items: [{ priceId }],
      settings: { displayMode: 'overlay', locale: 'ko' }
    });

    return true;
  } catch (e) {
    console.warn('Paddle checkout overlay failed (priceId flow), falling back', e);
    return false;
  }
}

async function handleBuyPlan(planCode) {
  try {
    const headers = await buildAuthHeaders();
    const res = await fetch('/api/buy-plan', {
      method: 'POST',
      headers,
      body: JSON.stringify({ planCode })
    });
    const json = await res.json();
    if (!json.success) {
      alert('결제 준비 중 오류가 발생했습니다.');
      return;
    }

    const paddlePayload = json.paddle || {};
    const priceId = json.paddlePriceId || paddlePayload.priceId;
    const clientToken = json.paddleClientToken || paddlePayload.clientToken;
    const env = json.paddleEnv || paddlePayload.environment;
    const sellerId = json.paddleSellerId || paddlePayload.sellerId;
    if (priceId && clientToken) {
      const opened = await openPaddleCheckoutWithPrice(priceId, clientToken, env, sellerId);
      if (opened) return;
    }

    if (json.checkoutUrl) {
      const opened = await openPaddleCheckoutUrl(json.checkoutUrl);
      if (!opened) {
        window.location.href = json.checkoutUrl;
      }
    } else {
      alert('결제 페이지가 아직 연결되지 않았습니다.');
    }
  } catch (e) {
    console.error('handleBuyPlan error', e);
    alert('결제 처리 중 오류가 발생했습니다.');
  }
}

async function handleWatchAd() {
  const infoEl = document.getElementById('cuAdInfo');
  if (infoEl) infoEl.textContent = '광고를 불러오는 중입니다...';

  try {
    // Before showing a web rewarded ad, create an ad session on the server.
    // The server returns a sessionId that we'll include in the ad request parameters so
    // the server can verify the ad completion later.
    // (If the server session creation fails we still fall back to the previous behavior.)
    let sessionId = null;
    try {
      const headers = await buildAuthHeaders();
      const sessionRes = await fetch('/api/ad-session', { method: 'POST', headers });
      const sessionJson = await sessionRes.json();
      if (sessionJson?.success && sessionJson.sessionId) sessionId = sessionJson.sessionId;
    } catch (e) {
      console.warn('ad-session creation failed, falling back to direct ad flow', e);
    }

    // 웹: Google Ad Manager / IMA SDK 또는 다른 웹 보상형 광고 SDK를 우선 사용
    // - window.loadWebRewardedAd(): 페이지에서 IMA/AdManager로 구현한 함수(권장)
    // - window.admobRewarded: 기존 네이티브 브리지(앱/webview) 백워드 호환
    // 구현 가이드는 아래 주석을 참고하세요.
    if (typeof window.loadWebRewardedAd === 'function') {
      // loadWebRewardedAd는 { completed: boolean, details?: object } 형태의 결과를 반환해야 합니다.
      // SDK에 따라 처리/검증 토큰을 함께 반환하도록 설계하세요.
      // pass session id to the web ad loader so it can be appended to ad tag params
      const result = await window.loadWebRewardedAd({ adTagUrl: undefined, extraParams: { sessionId } });
      if (!result || !result.completed) {
        // 사용자가 광고를 끝까지 보지 않았거나 광고 재생 실패
        const infoEl = document.getElementById('cuAdInfo');
        if (infoEl) infoEl.textContent = '광고 시청이 완료되지 않았습니다.';
        return;
      }
    } else if (window.admobRewarded && typeof window.admobRewarded.show === 'function') {
      // 네이티브 앱/웹뷰(기존) 백워드 호환
      await window.admobRewarded.show();
    } else {
      console.warn('광고용 인터페이스가 없습니다. 테스트 모드로 진행합니다.');
    }

    // When reporting the ad completion to the server include sessionId and ad verification details
    const headers2 = await buildAuthHeaders();
    const res = await fetch('/api/earn-credits', {
      method: 'POST',
      headers: headers2,
      body: JSON.stringify({ sessionId: sessionId, verification: result?.details || null })
    });
    const json = await res.json();

    if (!json.success) {
      if (json.error === 'limit_reached') {
        infoEl.textContent = json.message || '오늘은 더 이상 광고 보상을 받을 수 없습니다.';
      } else {
        infoEl.textContent = '광고 보상 처리 중 오류가 발생했습니다.';
      }
      return;
    }

    infoEl.textContent = `+${json.earned} 크레딧 지급 (오늘 ${json.usedToday}/${json.maxPerDay}회)`;

    if (typeof updateSidebarUserInfo === 'function') {
      updateSidebarUserInfo();
    }
  } catch (e) {
    console.error('handleWatchAd error', e);
    if (infoEl) infoEl.textContent = '광고 또는 보상 처리 중 오류가 발생했습니다.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // partial이 로드된 후에 실행되도록 약간 딜레이
  setTimeout(() => {
    const closeBtn = document.querySelector('[data-credit-upsell-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeCreditUpsell);
    }
    const watchAdBtn = document.getElementById('cuWatchAdBtn');
    if (watchAdBtn) {
      watchAdBtn.addEventListener('click', handleWatchAd);
    }

    loadCreditConfig();
  }, 300);
});

// 전역에서 사용
window.openCreditUpsell = openCreditUpsell;

/**
 * Web rewarded ad hook (개발용 기본 스텁)
 * -------------------------------------
 * - 실제 운영에서는 아래 함수를 페이지 레벨에서 대체하세요.
 * - 권장: Google Ad Manager + IMA SDK를 사용해 보상형 광고를 생성하고,
 *   광고 완료 시 서버로 검증/보상 요청을 보내는 형태로 구현합니다.
 *
 * 형태: window.loadWebRewardedAd = async () => ({ completed: true, details: {} })
 * 예) 테스트 스텁은 confirm()로 사용자가 광고 시청을 수락하면 completed=true 반환
 */
if (!window.loadWebRewardedAd) {
  window.loadWebRewardedAd = async function () {
    // 개발/테스트용 간단한 시뮬레이션: 사용자가 확인하면 광고 완료로 처리
    const doReward = confirm('테스트 모드: 광고를 시청했다고 가정하고 1회 보상(광고 완료)을 받을까요?');
    return { completed: doReward };
  };
}
