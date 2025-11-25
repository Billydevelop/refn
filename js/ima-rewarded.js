// js/ima-rewarded.js
// Simple IMA-based rewarded ad helper for web.
// NOTE: This is a lightweight example for testing/learning purposes.
// For production you'll want robust error handling, timeouts, and server-side verification.

(function () {
  // test adTagUrl (VAST) — in production use your GAM ad tag for reward units.
  const TEST_AD_TAG = 'https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&cust_params=sample_ct%3Drewarded&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=';

  let adsLoader, adsManager, adDisplayContainer, adContainer;
  let initialized = false;

  function initIma(adContainerId = 'imaAdContainer') {
    if (initialized) return;

    // create a container element if it doesn't exist
    adContainer = document.getElementById(adContainerId);
    if (!adContainer) {
      adContainer = document.createElement('div');
      adContainer.id = adContainerId;
      // ensure it overlays above other content
      adContainer.style.position = 'fixed';
      adContainer.style.inset = '0';
      adContainer.style.zIndex = '2000';
      adContainer.style.display = 'flex';
      adContainer.style.alignItems = 'center';
      adContainer.style.justifyContent = 'center';
      document.body.appendChild(adContainer);
    }

    // The IMA AdDisplayContainer requires an element to render into.
    adDisplayContainer = new google.ima.AdDisplayContainer(adContainer);
    adsLoader = new google.ima.AdsLoader(adDisplayContainer);

    // optional: subscribe to adsLoader events
    adsLoader.addEventListener(
      google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      onAdsManagerLoaded,
      false
    );

    adsLoader.addEventListener(
      google.ima.AdErrorEvent.Type.AD_ERROR,
      onAdError,
      false
    );

    initialized = true;
  }

  function onAdsManagerLoaded(adsManagerLoadedEvent) {
    // Get the ads manager.
    const adsRenderingSettings = new google.ima.AdsRenderingSettings();
    adsManager = adsManagerLoadedEvent.getAdsManager(null, adsRenderingSettings);

    // attach event listeners for rewarded flow
    adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, onAdError);
    adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, onAdComplete);
    adsManager.addEventListener(google.ima.AdEvent.Type.SKIPPED, onAdSkipped);
    adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, () => {
      // can update UI: hide 'watch ad' button, show player, etc.
    });
  }

  function onAdError(adErrorEvent) {
    // IMA's AdErrorEvent often contains an error object with details.
    try {
      const err = adErrorEvent.getError ? adErrorEvent.getError() : adErrorEvent.error || null;
      console.error('IMA Ad Error:', err, adErrorEvent);

      // Provide detailed stack/message if available
      if (err && (err.getMessage || err.message)) {
        const msg = err.getMessage ? err.getMessage() : err.message;
        console.error('IMA error message:', msg);
      }
    } catch (ex) {
      console.error('IMA Ad Error (failed to extract details):', ex, adErrorEvent);
    }
    // cleanup if needed
    try {
      if (adsManager) {
        adsManager.destroy();
      }
    } catch (e) {}
  }

  function onAdComplete() {
    // The ad finished. Resolve the promise from loadWebRewardedAd with completed true.
    if (lastResolve) {
      lastResolve({ completed: true });
    }
    cleanupAds();
  }

  function onAdSkipped() {
    if (lastResolve) {
      // return error details so caller can forward to server / log
      const errObj = adErrorEvent && (adErrorEvent.getError ? adErrorEvent.getError() : adErrorEvent.error) || { message: 'ad error' };
      lastResolve({ completed: false, details: { error: errObj } });
    }
    cleanupAds();
  }

  function cleanupAds() {
    try {
      if (adsManager) {
        adsManager.destroy();
        adsManager = null;
      }
    } catch (e) {}
  }

  let lastResolve = null;
  let lastReject = null;

  // Public API: loadWebRewardedAd
  window.loadWebRewardedAd = async function (options = {}) {
    // Ensure IMA SDK is available
    if (typeof google === 'undefined' || !google.ima) {
      console.warn('IMA SDK not loaded. Please include https://imasdk.googleapis.com/js/sdkloader/ima3.js');
      // fallback test flow
      const ok = confirm('IMA SDK가 로드되지 않았습니다. 테스트로 광고 완료를 시뮬레이션할까요?');
      return { completed: ok };
    }

    initIma(options.adContainerId);

    return new Promise((resolve, reject) => {
      lastResolve = resolve;
      lastReject = reject;

      try {
        // Important: AdDisplayContainer must be initialized after a user gesture (click)
        adDisplayContainer.initialize();

        const adsRequest = new google.ima.AdsRequest();
        // build adTagUrl; allow passing options.adTagUrl, or use TEST_AD_TAG
        let adTagUrl = options.adTagUrl || TEST_AD_TAG;
        // append encoded session id as cust_params so server/ad reporting can connect ad -> session
        const sessionId = options?.extraParams?.sessionId;
        if (sessionId) {
          const sep = adTagUrl.includes('?') ? '&' : '?';
          // Google ad Tag uses cust_params key; we URL encode
          adTagUrl = adTagUrl + sep + 'cust_params=' + encodeURIComponent('session_id=' + sessionId);
        }
        adsRequest.adTagUrl = adTagUrl; // Use GAM adTagUrl for production

        // Video slot size (not always used for rewarded)
        adsRequest.linearAdSlotWidth = options.width || 640;
        adsRequest.linearAdSlotHeight = options.height || 360;

        adsLoader.requestAds(adsRequest);

        // Start a short timeout in case ad request fails
        setTimeout(() => {
          if (lastResolve) {
            // treat as failed / not completed
            lastResolve({ completed: false });
            lastResolve = null;
            lastReject = null;
          }
        }, options.timeoutMs || 15000);

        // When adsManager is ready, call start() to play
        // We attach a small poll to wait for adsManager to be set by onAdsManagerLoaded
        (function waitForManager(count = 0) {
          if (adsManager) {
            try {
              adsManager.init(adsRequest.linearAdSlotWidth, adsRequest.linearAdSlotHeight, google.ima.ViewMode.NORMAL);
              adsManager.start();
            } catch (e) {
              console.error('adsManager start error', e);
            }
            return;
          }
          if (count > 60) {
            // timeout
            if (lastResolve) lastResolve({ completed: false, details: { error: 'ads request timeout' } });
            lastResolve = null;
            lastReject = null;
            return;
          }
          setTimeout(() => waitForManager(count + 1), 150);
        })();
      } catch (e) {
        console.error('loadWebRewardedAd failed', e);
        if (lastResolve) lastResolve({ completed: false });
        lastResolve = null;
        lastReject = null;
      }
    });
  };
})();
