/* ======================
   Supabase 전역 클라이언트
====================== */

// 🔹 Supabase 프로젝트 정보
const SUPABASE_URL = 'https://hvpovtlvrzcqbjdebegm.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2cG92dGx2cnpjcWJqZGViZWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MjMxODAsImV4cCI6MjA3OTE5OTE4MH0.B4KsZOL9KWW2q14pmzmexkzIliJ7oe8xSEZdrXoRNBM';

// 🔹 전역 Supabase 클라이언트 (window.sb 로 어디서나 사용)
window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sb = window.sb;

/* ======================
   HEAD PARTIAL LOAD
====================== */
async function loadHead() {
  try {
    const res = await fetch('./partials/head.html');
    const html = await res.text();
    document.head.insertAdjacentHTML('afterbegin', html);
  } catch (e) {
    console.error('head.html 로드 실패:', e);
  }
}

/* ======================
   사이드바 partial 로드
====================== */
async function initSidebar() {
  const container = document.getElementById('sidebar-container');
  if (!container) return;

  try {
    const res = await fetch('./partials/sidebar.html');
    container.innerHTML = await res.text();

    // 현재 페이지 기준 active
    const currentPage = document.body.dataset.page; // home / studio / menu / mypage / works ...
    if (currentPage) {
      const activeItem = container.querySelector(
        `.side-item[data-page="${currentPage}"]`
      );
      if (activeItem) {
        activeItem.classList.add('active');
      }
    }

    // 사이드바 DOM 들어온 뒤 유저 정보 / 크레딧 표시
    updateSidebarUserInfo();

    // 아바타 팝오버 이벤트 세팅
    setupAccountPopover();
  } catch (e) {
    console.error('사이드바 로드 실패:', e);
  }
}

/* ======================
   드로어 partial 로드
   → user_contents 기반 히스토리 + localStorage fallback
====================== */
async function initDrawer() {
  const container = document.getElementById('drawer-container');
  if (!container) return;

  try {
    const res = await fetch('./partials/drawer.html');
    container.innerHTML = await res.text();
  } catch (e) {
    console.error('드로어 로드 실패:', e);
    return;
  }

  const drawer = document.getElementById('globalDrawer');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const mobileNavBtn = document.getElementById('mobileNavBtn');

  const drawerList = document.getElementById('drawerList');
  const drawerEmpty = document.getElementById('drawerEmpty');
  const tabButtons = drawer ? drawer.querySelectorAll('.drawer-tab') : [];

  if (!drawer) return;

  /* ---- 열기/닫기 ---- */
  const openDrawer = () => {
    drawer.classList.remove('drawer-hidden');
  };

  const closeDrawer = () => {
    drawer.classList.add('drawer-hidden');
  };

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeDrawer);
  }

  if (mobileNavBtn) {
    mobileNavBtn.addEventListener('click', () => {
      drawer.classList.toggle('drawer-hidden');
    });
  }

  /* ---- 현재 페이지 기준 drawer-nav active ---- */
  const currentPage = document.body.dataset.page;
  if (currentPage) {
    const activeNav = drawer.querySelector(
      `.drawer-nav-item[data-page="${currentPage}"]`
    );
    if (activeNav) {
      activeNav.classList.add('active');
    }
  }

  if (!drawerList || !drawerEmpty) {
    return;
  }

  /* ==========================
     1) localStorage history (기존)
  =========================== */
  function getLocalHistory() {
    try {
      const raw = localStorage.getItem('seobaHistory');
      if (!raw) return { images: [], chats: [] };
      const data = JSON.parse(raw);
      return {
        images: data.images || [],
        chats: data.chats || [],
      };
    } catch (e) {
      console.error('local history parse error:', e);
      return { images: [], chats: [] };
    }
  }

  /* ==========================
     2) DB에서 user_contents 불러오기
  =========================== */
  async function fetchDbHistory() {
    try {
      const { data: sessionData, error: sessionError } =
        await sb.auth.getSession();
      if (sessionError || !sessionData.session) {
        return [];
      }

      const userId = sessionData.session.user.id;
      const { data, error } = await sb
        .from('user_contents')
        .select('id, kind, title, prompt, thumb_url, created_at, service_code')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('user_contents fetch error:', error);
        return [];
      }

      return (data || []).map((row) => ({
        source: 'db',
        id: row.id,
        kind: row.kind, // 'image', 'chat', ...
        title:
          row.title ||
          (row.prompt &&
            row.prompt.slice(0, 20) +
              (row.prompt.length > 20 ? '...' : '')) ||
          '콘텐츠',
        subtitle: row.created_at
          ? new Date(row.created_at).toLocaleDateString('ko-KR')
          : '',
        thumbUrl: row.thumb_url,
        serviceCode: row.service_code,
      }));
    } catch (e) {
      console.error('fetchDbHistory error:', e);
      return [];
    }
  }

  /* ==========================
     3) 최종 drawer 리스트 렌더링
  =========================== */
  async function renderDrawerList(activeTab = 'all') {
    const { images, chats } = getLocalHistory();
    const localItems = [];

    (chats || []).forEach((c) =>
      localItems.push({
        source: 'local',
        kind: 'chat',
        id: c.id,
        title: c.title || '새 채팅',
        subtitle: c.date || '',
      })
    );
    (images || []).forEach((img) =>
      localItems.push({
        source: 'local',
        kind: 'image',
        id: img.id,
        title: img.title || img.prompt || '이미지 생성',
        subtitle: img.createdAt
          ? new Date(img.createdAt).toLocaleDateString()
          : '',
        thumbUrl: img.thumbUrl || img.url,
      })
    );

    const dbItems = await fetchDbHistory();

    const items = [...dbItems, ...localItems]; // DB 우선 + local fallback

    const filtered = items.filter((item) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'image') return item.kind === 'image';
      if (activeTab === 'chat') return item.kind === 'chat';
      if (activeTab === 'etc') return !['image', 'chat'].includes(item.kind);
      return true;
    });

    drawerList.innerHTML = '';

    if (!filtered.length) {
      drawerEmpty.style.display = 'block';
      return;
    }

    drawerEmpty.style.display = 'none';

    filtered.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drawer-item';
      btn.dataset.kind = item.kind;
      btn.dataset.id = item.id;

      btn.innerHTML = `
        <div class="drawer-thumb">
          ${
            item.kind === 'image' && item.thumbUrl
              ? `<img src="${item.thumbUrl}" alt="thumb" />`
              : item.kind === 'chat'
              ? '💬'
              : '📄'
          }
        </div>
        <div class="drawer-meta">
          <div class="drawer-title">${item.title}</div>
          <div class="drawer-subline">${item.subtitle || ''}</div>
        </div>
        <div class="drawer-type-badge">
          ${
            item.kind === 'image'
              ? '이미지'
              : item.kind === 'chat'
              ? '채팅'
              : '콘텐츠'
          }
        </div>
      `;

      btn.addEventListener('click', () => {
        if (item.kind === 'image') {
          // 지금은 studio로만 라우팅
          window.location.href = 'studio.html';
        } else if (item.kind === 'chat') {
          window.location.href = 'index.html';
        }
      });

      drawerList.appendChild(btn);
    });
  }

  // 탭 클릭 이벤트
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-drawer-tab') || 'all';
      renderDrawerList(tab);
    });
  });

  // 최초 렌더
  renderDrawerList('all');
}

/* ======================
   CREDIT UPSELL PARTIAL
   → Inserts global upsell modal HTML into the document body so
     any page can open it via window.openCreditUpsell()
====================== */
async function loadCreditUpsellPartial() {
  try {
    // avoid double-inserting
    if (document.getElementById('creditUpsellModal')) return;

    const res = await fetch('./partials/credit-upsell.html');
    if (!res.ok) return;
    const html = await res.text();
    document.body.insertAdjacentHTML('beforeend', html);
  } catch (e) {
    console.error('credit-upsell partial load failed:', e);
  }
}

// expose for other scripts to call (e.g. when a caller wants to ensure modal exists)
window.loadCreditUpsellPartial = loadCreditUpsellPartial;

/* ======================
   유저 컨텍스트 / 사이드바 업데이트
====================== */

async function fetchUserContext() {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError || !sessionData.session) {
    console.warn('로그인 세션 없음 또는 에러', sessionError);
    return null;
  }

  const user = sessionData.session.user;

  const [{ data: profile }, { data: wallet }, { data: subscription }] =
    await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      sb
        .from('credit_wallets')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle(),
      sb
        .from('subscriptions')
        .select('status, plan_id, plans(name, code)')
        .eq('user_id', user.id)
        .eq('is_primary', true)
        .maybeSingle(),
    ]);

  return { user, profile, wallet, subscription };
}

async function updateSidebarUserInfo() {
  const sidebarCreditsEl = document.getElementById('sidebarCredits');
  const sidebarAvatarTextEl = document.getElementById('sidebarAvatarText');

  const accountAvatarCircle = document.getElementById('accountAvatarCircle');
  const accountNameEl = document.getElementById('accountName');
  const accountCreditsEl = document.getElementById('accountCredits');

  if (!sidebarCreditsEl || !sidebarAvatarTextEl) {
    return;
  }

  const ctx = await fetchUserContext();
  if (!ctx) {
    sidebarCreditsEl.textContent = '-';
    sidebarAvatarTextEl.textContent = '로그인';

    if (accountCreditsEl) accountCreditsEl.textContent = '-';
    if (accountNameEl) accountNameEl.textContent = '로그인 필요';
    if (accountAvatarCircle) accountAvatarCircle.textContent = '로그인';
    return;
  }

  const { user, profile, wallet } = ctx;

  const balance = wallet?.balance ?? profile?.current_credits ?? 0;
  const balanceText = balance.toLocaleString('ko-KR');

  sidebarCreditsEl.textContent = balanceText;
  if (accountCreditsEl) accountCreditsEl.textContent = balanceText;

  const fullName =
    profile?.display_name ||
    user.user_metadata?.name ||
    user.email ||
    '계정';

  const shortName =
    fullName.length <= 2 ? fullName : fullName.slice(-2);

  sidebarAvatarTextEl.textContent = shortName;
  sidebarAvatarTextEl.title = fullName;

  if (accountAvatarCircle) {
    accountAvatarCircle.textContent = shortName;
    accountAvatarCircle.title = fullName;
  }

  const handle =
    profile?.handle ||
    user.user_metadata?.user_name ||
    (user.email ? user.email.split('@')[0] : '');
  if (accountNameEl) {
    accountNameEl.textContent = handle || fullName;
  }
}

/* ======================
   사이드바 아바타 팝오버
====================== */
function setupAccountPopover() {
  const avatarBtn = document.getElementById('sidebarAvatar');
  const popover = document.getElementById('accountPopover');
  const logoutBtn = document.getElementById('accountLogout');
  const creditBtn = document.querySelector('[data-account-link="credits"]');
  const mypageBtn = document.querySelector('[data-account-link="mypage"]');

  if (!avatarBtn || !popover) return;

  avatarBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    const { data } = await sb.auth.getSession();
    if (!data || !data.session) {
      window.location.href = 'login.html';
      return;
    }

    popover.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== avatarBtn) {
      popover.classList.remove('open');
    }
  });

  if (creditBtn) {
    creditBtn.addEventListener('click', () => {
      window.location.href = 'works.html'; // 임시: 전체 작업물 화면
    });
  }

  if (mypageBtn) {
    mypageBtn.addEventListener('click', () => {
      window.location.href = 'mypage.html';
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await sb.auth.signOut();
        window.location.href = 'login.html';
      } catch (err) {
        console.error('로그아웃 실패', err);
      }
    });
  }
}

/* ======================
   공통: user_contents bulk 저장 헬퍼
====================== */
async function saveUserContentsBulk(items) {
  try {
    const { data: sessionData, error: sessionError } =
      await sb.auth.getSession();
    if (sessionError || !sessionData.session) {
      console.warn('saveUserContentsBulk: 로그인 안 돼 있어 DB 저장 생략');
      return;
    }

    const userId = sessionData.session.user.id;

    const rows = items.map((item) => ({
      user_id: userId,
      service_code: item.service_code,
      kind: item.kind,
      title: item.title || null,
      prompt: item.prompt || null,
      keywords: item.keywords || null,
      thumb_url: item.thumb_url || null,
      full_url: item.full_url || null,
      extra: item.extra || null,
    }));

    if (!rows.length) return;

    const { error } = await sb.from('user_contents').insert(rows);
    if (error) {
      console.error('saveUserContentsBulk insert error', error);
    }
  } catch (e) {
    console.error('saveUserContentsBulk error', e);
  }
}

window.fetchUserContext = fetchUserContext;
window.updateSidebarUserInfo = updateSidebarUserInfo;
window.saveUserContentsBulk = saveUserContentsBulk;

/* ======================
   초기화
====================== */
document.addEventListener('DOMContentLoaded', () => {
  loadHead();
  initSidebar();
  initDrawer();
  // make credit upsell modal available globally
  loadCreditUpsellPartial();
})
