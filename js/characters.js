// ================================
// 탭 전환
// ================================
document.querySelectorAll('.side-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panelId = tab.dataset.panel;

    document
      .querySelectorAll('.side-tab')
      .forEach(t => t.classList.remove('side-tab--active'));

    tab.classList.add('side-tab--active');

    document
      .querySelectorAll('.side-panel')
      .forEach(p => p.classList.remove('side-panel--active'));

    document.getElementById(panelId).classList.add('side-panel--active');
  });
});

// ================================
// URL 파라미터로 캐릭터 ID 추출
// ================================
function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

async function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch (e) {
    console.warn('session fetch failed', e);
  }
  return headers;
}

async function ensureCreditUpsell() {
  try {
    if (!document.getElementById('creditUpsellModal') && typeof window.loadCreditUpsellPartial === 'function') {
      await window.loadCreditUpsellPartial();
    }
  } catch (e) {
    console.warn('credit upsell load failed', e);
  }
}

async function openCreditUpsellSafe() {
  await ensureCreditUpsell();
  if (typeof window.openCreditUpsell === 'function') {
    window.openCreditUpsell();
  }
}

async function safeParseJson(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    console.warn('response json parse failed', err);
    return null;
  }
}

// ================================
// 캐릭터 데이터 로드
// ================================
async function fetchCharacter(id) {
  const { data, error } = await sb
    .from("characters")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("캐릭터 조회 오류:", error);
    return null;
  }
  return data;
}

// ================================
// HTML 렌더링 — 새 HTML 구조에 맞춰 수정
// ================================
function renderCharacterDetail(c) {
  // 헤더 아바타들
  const avatarImgs = document.querySelectorAll(".character-avatar");
  avatarImgs.forEach(img => {
    img.src = c.avatar_url || "/assets/img/sample-character-01.png";
    img.alt = c.name;
  });

  // 캐릭터 이름
  const nameEl = document.querySelector(".character-name");
  if (nameEl) nameEl.textContent = c.name;

  // 페이지 타이틀도 변경
  document.title = `${c.name} | 레픈`;

  // 수익쉐어 뱃지
  const shareBadge = document.querySelector(".badge--share");
  if (shareBadge) {
    shareBadge.style.display = c.is_monetized ? "inline-flex" : "none";
  }

  // 한 줄 소개 (tagline)
  const taglineEl = document.querySelector(".character-tagline");
  if (taglineEl) taglineEl.textContent = c.one_line || "";

  // 통계 (좋아요/댓글/조회수)
  const statItems = document.querySelectorAll(".stat-item span:last-child");
  if (statItems[0]) statItems[0].textContent = formatNumber(c.like_count || 0);
  if (statItems[1]) statItems[1].textContent = formatNumber(c.chat_count || 0);
  if (statItems[2]) statItems[2].textContent = formatNumber(c.view_count || 0);

  // 상세 패널: 설명
  const descPanel = document.querySelector("#profilePanel .panel-section-text");
  if (descPanel) descPanel.textContent = c.description || "설명이 없습니다.";

  // 상세 패널: 장르/타겟/해시태그
  const infoValues = document.querySelectorAll("#profilePanel .info-value");
  if (infoValues[0]) infoValues[0].textContent = c.genre || "-";
  if (infoValues[1]) infoValues[1].textContent = c.target || "-";
  if (infoValues[2]) {
    const tags = (c.tags || []).map(t => `#${t}`).join(" ");
    infoValues[2].textContent = tags || "-";
  }

  // 플레이 가이드
  const guideEl = document.querySelector("#guidePanel .panel-section-text");
  if (guideEl) guideEl.textContent = c.play_guide || "가이드 정보가 없습니다.";

  // 크리에이터 정보
  const creatorValues = document.querySelectorAll("#creatorPanel .creator-value");
  if (creatorValues[0]) creatorValues[0].textContent = c.creator_name || "@익명";
  if (creatorValues[1]) {
    creatorValues[1].textContent = c.revenue_share || "50% (플랫폼) / 50% (크리에이터)";
  }
}

// 숫자 포맷팅 함수
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// ================================
// 채팅 기록 로드
// ================================
async function loadChatHistory(characterId) {
  const sessionKey = `cc_session_${characterId}`;
  let sessionId = localStorage.getItem(sessionKey);

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  }

  const { data, error } = await sb
    .from("character_chats")
    .select("*")
    .eq("character_id", characterId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("채팅 기록 오류:", error);
    return;
  }

  const chatWindow = document.getElementById("chatWindow");
  if (!chatWindow) return;

  chatWindow.innerHTML = "";

  if (data && data.length > 0) {
    data.forEach(msg => {
      chatWindow.appendChild(renderMessage(msg));
    });
  }

  checkChatEmpty();
  scrollToBottom();
}

// ================================
// 말풍선 렌더
// ================================
function renderMessage(msg) {
  const el = document.createElement("div");
  el.className = "chat-message " + (msg.role === "character" ? "chat-message--character" : "chat-message--user");

  if (msg.role === "character") {
    const avatarSrc = document.querySelector('.character-avatar')?.src || "/assets/img/sample-character-01.png";
    const characterName = document.querySelector('.character-name')?.textContent || "캐릭터";
    
    el.innerHTML = `
      <div class="chat-message__avatar">
        <img src="${avatarSrc}" alt="${characterName}" />
      </div>
      <div class="chat-message__bubble">
        <div class="chat-message__name">${characterName}</div>
        <div class="chat-message__text">${escapeHtml(msg.content)}</div>
        <div class="chat-message__meta">${formatTime(msg.created_at)}</div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="chat-message__bubble">
        <div class="chat-message__name">나</div>
        <div class="chat-message__text">${escapeHtml(msg.content)}</div>
        <div class="chat-message__meta">${formatTime(msg.created_at)}</div>
      </div>
    `;
  }

  return el;
}

// HTML 이스케이프 함수
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 시간 포맷팅 함수
function formatTime(timestamp) {
  if (!timestamp) return "방금 전";
  
  const now = new Date();
  const time = new Date(timestamp);
  const diff = Math.floor((now - time) / 1000); // 초 단위

  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  
  return time.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// ================================
// 채팅 전송 기능
// ================================
async function setupChat(characterId) {
  const form = document.getElementById("chatForm");
  const textarea = form.querySelector(".chat-input-field");
  const chatWindow = document.getElementById("chatWindow");

  const sessionKey = `cc_session_${characterId}`;
  let sessionId = localStorage.getItem(sessionKey);

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  }

  // textarea 자동 높이 조절
  textarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Enter 키로 전송 (Shift+Enter는 줄바꿈)
  textarea.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    
    textarea.value = "";
    textarea.style.height = 'auto';

    // 사용자 메시지 화면 렌더
    const userMsg = {
      role: "user",
      content: text,
      created_at: new Date().toISOString()
    };
    chatWindow.appendChild(renderMessage(userMsg));
    scrollToBottom();
    checkChatEmpty();

    // 로딩 인디케이터 추가
    const loadingEl = createLoadingMessage();
    chatWindow.appendChild(loadingEl);
    scrollToBottom();

    try {
      const headers = await buildAuthHeaders();
      const response = await fetch(`/api/characters/${characterId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId,
          message: text
        })
      });
      const result = await safeParseJson(response) || {};

      // 로딩 제거
      loadingEl.remove();

      if (response.status === 401) {
        const errorMsg = {
          role: "character",
          content: "로그인이 필요합니다. 로그인 후 다시 시도해주세요.",
          created_at: new Date().toISOString()
        };
        chatWindow.appendChild(renderMessage(errorMsg));
        scrollToBottom();
        return;
      }

      if (response.status === 402 || result?.error === 'insufficient_credits') {
        const errorMsg = {
          role: "character",
          content: "크레딧이 부족합니다. 충전 또는 구독 후 다시 시도해주세요.",
          created_at: new Date().toISOString()
        };
        chatWindow.appendChild(renderMessage(errorMsg));
        scrollToBottom();
        openCreditUpsellSafe();
        return;
      }

      if (!response.ok) {
        const errorMsg = {
          role: "character",
          content: `서버 응답 오류 (${response.status}): ${result.error || '요청을 완료하지 못했습니다.'}`,
          created_at: new Date().toISOString()
        };
        chatWindow.appendChild(renderMessage(errorMsg));
        scrollToBottom();
        checkChatEmpty();
        return;
      }

      if (result.characterMessage) {
        chatWindow.appendChild(renderMessage(result.characterMessage));
        scrollToBottom();
        checkChatEmpty();
      } else {
        const errorMsg = {
          role: "character",
          content: "오류가 발생했습니다: " + (result.error || "알 수 없는 오류"),
          created_at: new Date().toISOString()
        };
        chatWindow.appendChild(renderMessage(errorMsg));
        scrollToBottom();
        checkChatEmpty();
      }
    } catch (err) {
      loadingEl.remove();
      const errorMsg = {
        role: "character",
        content: "서버 연결 오류: " + err.message,
        created_at: new Date().toISOString()
      };
      chatWindow.appendChild(renderMessage(errorMsg));
      scrollToBottom();
      checkChatEmpty();
    }
  });
}

// 로딩 메시지 생성
function createLoadingMessage() {
  const el = document.createElement("div");
  el.className = "chat-message chat-message--character chat-message--loading";
  const avatarSrc = document.querySelector('.character-avatar')?.src || "/assets/img/sample-character-01.png";
  
  el.innerHTML = `
    <div class="chat-message__avatar">
      <img src="${avatarSrc}" alt="캐릭터" />
    </div>
    <div class="chat-message__bubble">
      <div class="chat-message__text">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
    </div>
  `;
  
  return el;
}

// 채팅 스크롤을 맨 아래로
function scrollToBottom() {
  const container = document.querySelector('.chat-messages-container');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// ================================
// 빈 채팅 안내
// ================================
function checkChatEmpty() {
  const chatWindow = document.getElementById('chatWindow');
  if (!chatWindow) return;

  const hasMessages = chatWindow.querySelector('.chat-message:not(.chat-message--loading)');
  
  if (!hasMessages) {
    chatWindow.classList.add('chat-window--empty');
    if (!chatWindow.querySelector('.empty-state')) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = `
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <p>아직 대화가 없습니다<br>메시지를 입력해 대화를 시작하세요!</p>
      `;
      chatWindow.appendChild(emptyState);
    }
  } else {
    chatWindow.classList.remove('chat-window--empty');
    const emptyState = chatWindow.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
  }
}

// ================================
// 우측 패널 토글
// ================================
function setupSidePanel() {
  const sidePanel = document.querySelector('.character-side');
  const toggleBtn = document.getElementById('sideToggleBtn');
  const closeBtn = document.getElementById('closeSideBtn');

  if (!sidePanel) return;

  // 토글 버튼
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidePanel.classList.toggle('character-side--collapsed');
    });
  }

  // 닫기 버튼
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      sidePanel.classList.add('character-side--collapsed');
    });
  }

  // 모바일에서 배경 클릭시 닫기
  if (window.innerWidth <= 1024) {
    const overlay = document.createElement('div');
    overlay.className = 'side-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999;
      display: none;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(overlay);

    const observer = new MutationObserver(() => {
      if (sidePanel.classList.contains('character-side--collapsed')) {
        overlay.style.display = 'none';
      } else {
        overlay.style.display = 'block';
      }
    });

    observer.observe(sidePanel, { attributes: true, attributeFilter: ['class'] });

    overlay.addEventListener('click', () => {
      sidePanel.classList.add('character-side--collapsed');
    });
  }
}

// ================================
// 좋아요 버튼
// ================================
function setupFavoriteButton(characterId) {
  const favoriteBtn = document.querySelector('.btn-favorite');
  if (!favoriteBtn) return;

  // 로컬 스토리지에서 좋아요 상태 확인
  const favoriteKey = `favorite_${characterId}`;
  const isFavorite = localStorage.getItem(favoriteKey) === 'true';
  
  if (isFavorite) {
    favoriteBtn.classList.add('active');
  }

  favoriteBtn.addEventListener('click', async () => {
    const isActive = favoriteBtn.classList.toggle('active');
    localStorage.setItem(favoriteKey, isActive);

    // 서버에 좋아요 상태 전송 (옵션)
    try {
      const headers = await buildAuthHeaders();
      await fetch(`/api/characters/${characterId}/like`, {
        method: isActive ? 'POST' : 'DELETE',
        headers
      });
    } catch (err) {
      console.warn('좋아요 처리 실패:', err);
    }
  });
}

// ================================
// 페이지 초기화
// ================================
document.addEventListener("DOMContentLoaded", async () => {
  const characterId = getParam("id");
  if (!characterId) {
    console.error("캐릭터 ID가 없습니다.");
    return;
  }

  // 캐릭터 데이터 로드 및 렌더링
  const data = await fetchCharacter(characterId);
  if (!data) {
    console.error("캐릭터를 찾을 수 없습니다.");
    return;
  }

  renderCharacterDetail(data);
  await loadChatHistory(characterId);
  setupChat(characterId);
  setupSidePanel();
  setupFavoriteButton(characterId);
  checkChatEmpty();
});

// 로딩 애니메이션 CSS 추가
const style = document.createElement('style');
style.textContent = `
  .loading-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin: 0 2px;
    background: currentColor;
    border-radius: 50%;
    opacity: 0.4;
    animation: loadingDot 1.4s infinite;
  }
  .loading-dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .loading-dot:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes loadingDot {
    0%, 60%, 100% {
      opacity: 0.4;
      transform: scale(1);
    }
    30% {
      opacity: 1;
      transform: scale(1.2);
    }
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px 20px;
    text-align: center;
    color: #6b6c72;
    font-size: 14px;
    line-height: 1.6;
  }
`;
document.head.appendChild(style);

// 전역으로 노출
window.checkChatEmpty = checkChatEmpty;
