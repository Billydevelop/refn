// js/studio.js


// 🔹 한 번 이미지 생성 호출당 차감할 크레딧 양 (원하는 값으로 조정)
const CREDITS_PER_GENERATION_CALL = 100;

// chargeCreditsForGeneration is defined below (single consolidated implementation).
/**
 * 로그인 여부 체크
 */
async function ensureLoggedIn() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

/**
 * 이미지 생성 전에 크레딧 차감 RPC 호출
 * - credit_wallets 잔액 부족이면 에러를 던진다.
 */
async function chargeCreditsForGeneration() {
  const { error } = await sb.rpc('use_credits', {
    p_amount: CREDITS_PER_GENERATION_CALL,
    p_service_code: 'REFN_STUDIO',
    p_category: 'normal', // credit_usage_category enum
  });

  if (error) {
    // Log for debugging
    console.error('use_credits error', error);

    // Depending on backend message shape, check a few possibilities for insufficient-credit responses
    const msg = (error.message || '').toLowerCase();
      if (msg.includes('insufficient') || msg.includes('not enough')) {
        // Try to open the credit upsell UI in a robust way even if scripts
        // are loaded in an unexpected order. Prefer window.openCreditUpsell()
        // if available; otherwise ask the common loader to insert the partial
        // and then attempt to call the opener.
        (async () => {
          try {
            if (typeof window.openCreditUpsell === 'function') {
              window.openCreditUpsell();
              return;
            }

            // If loader exists, insert partial
            if (typeof window.loadCreditUpsellPartial === 'function') {
              await window.loadCreditUpsellPartial();
            } else {
              // fallback: try to fetch the partial directly
              try {
                const res = await fetch('./partials/credit-upsell.html');
                if (res.ok) {
                  const html = await res.text();
                  document.body.insertAdjacentHTML('beforeend', html);
                }
              } catch (e) {
                console.error('fallback load upsell partial failed', e);
              }
            }

            // If credits script later defines openCreditUpsell, call it.
            if (typeof window.openCreditUpsell === 'function') {
              window.openCreditUpsell();
              return;
            }

            // If still not defined, attempt to show modal element directly
            const modal = document.getElementById('creditUpsellModal');
            if (modal) modal.classList.remove('hidden');
          } catch (e) {
            console.error('failed to show credit upsell', e);
          }
        })();
    }

    // Preserve existing behavior by rethrowing so callers can handle the error too
    throw error;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initStudioPage();
});

function initStudioPage() {
  // ===== 공통 DOM 캐시 =====
  const modeReferenceBtn = document.getElementById('modeReferenceBtn');
  const modeDirectBtn = document.getElementById('modeDirectBtn');
  const chipList = document.getElementById('chipList');
  const keywordInput = document.getElementById('keywordInput');
  const promptInput = document.getElementById('promptInput');

  const searchRefBtn = document.getElementById('searchRefBtn');
  const generateFromRefBtn = document.getElementById('generateFromRefBtn');
  const directGenerateBtn = document.getElementById('directGenerateBtn');

  const refGrid = document.getElementById('refGrid');
  const refEmpty = document.getElementById('refEmpty');
  const refCountBadge = document.getElementById('refCountBadge');

  const genGrid = document.getElementById('genGrid');
  const genEmpty = document.getElementById('genEmpty');

  let currentMode = 'reference';
  let selectedRefIds = new Set();
  let refDataById = new Map();

  // ---- 이미지 모달 DOM ----
  const imageModal = document.getElementById('imageModal');
  const imageModalImg = document.getElementById('imageModalImg');
  const imageModalClose = document.getElementById('imageModalClose');

  function openImageModal(url) {
    imageModalImg.src = url;
    imageModal.classList.remove('hidden');
  }

  function closeImageModal() {
    imageModal.classList.add('hidden');
    imageModalImg.src = '';
  }

  imageModalClose.addEventListener('click', closeImageModal);
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) closeImageModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !imageModal.classList.contains('hidden')) {
      closeImageModal();
    }
  });

  // ===== 모드 토글 =====
  modeReferenceBtn.addEventListener('click', () => {
    currentMode = 'reference';
    modeReferenceBtn.classList.add('active');
    modeDirectBtn.classList.remove('active');
  });

  modeDirectBtn.addEventListener('click', () => {
    currentMode = 'direct';
    modeDirectBtn.classList.add('active');
    modeReferenceBtn.classList.remove('active');
  });

  // ===== 키워드 칩 클릭 → input 반영 =====
  chipList.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    chip.classList.toggle('active');

    const activeChips = Array.from(
      document.querySelectorAll('.chip.active')
    ).map((c) => c.textContent.trim());

    const typed = keywordInput.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);

    const merged = Array.from(new Set([...typed, ...activeChips]));
    keywordInput.value = merged.join(', ');
  });

  // ===== 레퍼런스 개수 배지 업데이트 =====
  function updateRefCount() {
    const count = selectedRefIds.size;
    refCountBadge.innerHTML =
      '<span class="badge-dot"></span>선택된 레퍼런스 ' + count + '개';
  }

  // ===== 백엔드로 실제 레퍼런스 요청 =====
  async function fetchReferencesFromServer() {
    const prompt = promptInput.value.trim();
    const keywords = keywordInput.value.trim();

    const res = await fetch('/api/search-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, keywords }),
    });

    if (!res.ok) {
      throw new Error('search failed');
    }
    return await res.json(); // [{id, thumbUrl, fullUrl, tags, source}, ...]
  }

  // ===== 레퍼런스 렌더링 =====
  async function renderReferences() {
    refGrid.innerHTML = '';
    selectedRefIds = new Set();
    refDataById = new Map();
    updateRefCount();

    refEmpty.textContent = '레퍼런스를 불러오는 중입니다...';
    refEmpty.hidden = false;
    refGrid.hidden = true;

    try {
      const refs = await fetchReferencesFromServer();

      if (!refs.length) {
        refEmpty.textContent =
          '검색 결과가 없습니다. 프롬프트/키워드를 바꿔보세요.';
        return;
      }

      refGrid.innerHTML = '';
      refs.forEach((ref) => {
        refDataById.set(ref.id, ref);

        const card = document.createElement('div');
        card.className = 'ref-card';
        card.dataset.id = ref.id;

        card.style.backgroundImage = `url(${ref.thumbUrl})`;
        card.style.backgroundSize = 'cover';
        card.style.backgroundPosition = 'center';

        card.innerHTML = `
          <div class="ref-overlay">
            <div class="ref-keywords">${
              (ref.tags && ref.tags.length ? ref.tags : ['reference'])
                .slice(0, 4)
                .join(', ')
            }</div>
            <div class="ref-meta">${ref.source || ''}</div>
          </div>
          <div class="ref-check">✓</div>
          <button class="ref-zoom-btn" type="button" title="크게 보기">🔍</button>
        `;

        const zoomBtn = card.querySelector('.ref-zoom-btn');
        zoomBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = ref.fullUrl || ref.thumbUrl;
          openImageModal(url);
        });

        card.addEventListener('click', () => {
          const id = card.dataset.id;
          if (selectedRefIds.has(id)) {
            selectedRefIds.delete(id);
            card.classList.remove('selected');
          } else {
            if (selectedRefIds.size >= 8) {
              alert('레퍼런스는 최대 8개까지 선택할 수 있습니다.');
              return;
            }
            selectedRefIds.add(id);
            card.classList.add('selected');
          }
          updateRefCount();
        });

        refGrid.appendChild(card);
      });

      refEmpty.hidden = true;
      refGrid.hidden = false;
    } catch (err) {
      console.error(err);
      refEmpty.textContent =
        '레퍼런스를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      refEmpty.hidden = false;
      refGrid.hidden = true;
    }
  }

  // “레퍼런스 검색” → 로그인만 체크 (크레딧 차감 없음)
  searchRefBtn.addEventListener('click', async () => {
    const ok = await ensureLoggedIn();
    if (!ok) return;

    await renderReferences();

    if (currentMode === 'direct') {
      currentMode = 'reference';
      modeReferenceBtn.classList.add('active');
      modeDirectBtn.classList.remove('active');
    }
  });

  // ===== 생성 이미지 관련 =====
  function getSelectedReferenceUrls() {
    return Array.from(selectedRefIds)
      .map((id) => refDataById.get(id))
      .filter(Boolean)
      .map((ref) => ref.fullUrl);
  }

  async function generateImages(mode) {
    const prompt = promptInput.value.trim();
    const keywords = keywordInput.value.trim();
    const referenceUrls =
      mode === 'reference' ? getSelectedReferenceUrls() : [];

    // 1) 로그인 & 크레딧 차감
    const loggedIn = await ensureLoggedIn();
    if (!loggedIn) return;

    genEmpty.textContent = '크레딧을 차감하는 중입니다...';
    genEmpty.hidden = false;
    genGrid.hidden = true;
    genGrid.innerHTML = '';

    try {
      await chargeCreditsForGeneration();
    } catch (err) {
      console.error('chargeCreditsForGeneration error', err);
      const msg =
        err.message && err.message.includes('insufficient_credits')
          ? '크레딧이 부족합니다. 크레딧을 충전한 뒤 다시 시도해주세요.'
          : '크레딧 차감 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

      genEmpty.textContent = msg;
      genEmpty.hidden = false;
      genGrid.hidden = true;

      // 사이드바 크레딧도 다시 로딩
      window.updateSidebarUserInfo?.();
      return;
    }

    // 2) 실제 이미지 생성
    genEmpty.textContent = '이미지를 생성하는 중입니다...';
    genEmpty.hidden = false;
    genGrid.hidden = true;

    try {
      const res = await fetch('/api/generate-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, keywords, referenceUrls, mode }),
      });

      if (!res.ok) {
        throw new Error('generate failed');
      }

      const data = await res.json();
      const images = (data.images || []).filter(Boolean);

      if (!images.length) {
        genEmpty.textContent =
          '생성 결과가 없습니다. 프롬프트나 레퍼런스를 조금 바꿔보세요.';
        genEmpty.hidden = false;
        genGrid.hidden = true;
        return;
      }

      genGrid.innerHTML = '';
      images.forEach((imageUrl, idx) => {
        const card = document.createElement('div');
        card.className = 'gen-card';
        card.innerHTML = `
          <img src="${imageUrl}" alt="generated ${idx + 1}" style="width:100%;height:100%;object-fit:cover;" />
          <button class="gen-zoom-btn" type="button" title="크게 보기">🔍</button>
          <a class="gen-download-btn" href="${imageUrl}" download="refn-image-${idx + 1}.png" title="다운로드">⬇</a>
          <div class="gen-caption">
            <strong>${
              mode === 'direct' ? '프롬프트 기반' : '레퍼런스 기반'
            } 이미지 ${idx + 1}</strong><br/>
            ${prompt || '설정된 프롬프트 없음'}<br/>
            <span style="opacity:.7;font-size:10px;">${
              keywords || 'keywords: -'
            }</span>
          </div>
        `;

        const zoomBtn = card.querySelector('.gen-zoom-btn');
        zoomBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openImageModal(imageUrl);
        });

        const downloadBtn = card.querySelector('.gen-download-btn');
        downloadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        genGrid.appendChild(card);
      });

      genEmpty.hidden = true;
      genGrid.hidden = false;

      // (A) localStorage 히스토리 저장
      try {
        const raw = localStorage.getItem('seobaHistory');
        const history = raw ? JSON.parse(raw) : { images: [], chats: [] };

        const now = new Date().toISOString();
        const newItems = images.map((imageUrl, idx) => ({
          id: `${Date.now()}_${idx}`,
          url: imageUrl,
          thumbUrl: imageUrl,
          prompt,
          keywords,
          createdAt: now,
          title:
            (prompt &&
              prompt.slice(0, 20) +
                (prompt.length > 20 ? '...' : '')) || '이미지 생성',
        }));

        history.images = [...newItems, ...(history.images || [])].slice(
          0,
          50
        );
        localStorage.setItem('seobaHistory', JSON.stringify(history));
      } catch (e) {
        console.error('save history error', e);
      }

      // (B) Supabase user_contents에도 저장 (이미 구현해둔 헬퍼 사용)
      try {
        const now = new Date().toISOString();
        const itemsForDb = images.map((imageUrl, idx) => ({
          service_code: 'REFN_STUDIO',
          kind: 'image',
          title:
            (prompt &&
              prompt.slice(0, 20) +
                (prompt.length > 20 ? '...' : '')) ||
            `이미지 ${idx + 1}`,
          prompt,
          keywords,
          thumb_url: imageUrl,
          full_url: imageUrl,
          extra: {
            mode,
            index: idx,
            created_at_client: now,
          },
        }));

        await window.saveUserContentsBulk(itemsForDb);
      } catch (e) {
        console.error('DB history save error', e);
      }

      // 크레딧 표시 갱신
      window.updateSidebarUserInfo?.();
    } catch (err) {
      console.error(err);
      genEmpty.textContent =
        '이미지 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      genEmpty.hidden = false;
      genGrid.hidden = true;
    }
  }

  // “선택 레퍼런스로 생성”
  generateFromRefBtn.addEventListener('click', async () => {
    if (selectedRefIds.size === 0) {
      alert('생성할 레퍼런스를 하나 이상 선택해주세요.');
      return;
    }
    await generateImages('reference');
  });

  // “프롬프트로 바로 생성”
  directGenerateBtn.addEventListener('click', async () => {
    if (!promptInput.value.trim()) {
      const okPrompt = confirm(
        '프롬프트가 비어있어요. 기본 문장으로 바로 생성할까요?'
      );
      if (!okPrompt) return;
      if (!promptInput.value.trim()) {
        promptInput.value =
          'abstract colorful shapes, smooth gradient, 3d feel';
      }
    }
    currentMode = 'direct';
    modeDirectBtn.classList.add('active');
    modeReferenceBtn.classList.remove('active');

    await generateImages('direct');
  });
}
