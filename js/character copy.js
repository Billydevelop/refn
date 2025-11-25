// ================================
// 탭 전환
// ================================
document.querySelectorAll('.character-side .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panelId = tab.dataset.panel;

    document
      .querySelectorAll('.character-side .tab')
      .forEach(t => t.classList.remove('tab--active'));

    tab.classList.add('tab--active');

    document
      .querySelectorAll('.character-side .panel')
      .forEach(p => p.classList.remove('panel--active'));

    document.getElementById(panelId).classList.add('panel--active');
  });
});

// ================================
// URL 파라미터로 캐릭터 ID 추출
// ================================
function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
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
// HTML 렌더링 — HTML 구조에 맞춰 수정
// ================================
function renderCharacterDetail(c) {

  // 헤더 아바타
  const avatarImg = document.querySelector(".character-chat__avatar img");
  if (avatarImg) avatarImg.src = c.avatar_url || "/assets/img/sample-character-01.png";

  // 캐릭터 이름
  const nameEl = document.querySelector(".character-chat__name");
  if (nameEl) nameEl.textContent = c.name;

  // 수익쉐어 뱃지
  const shareBadge = document.querySelector(".badge--share");
  if (shareBadge) shareBadge.style.display = c.is_monetized ? "inline-flex" : "none";

  // 좋아요/댓글/조회수
  const metaEl = document.querySelector(".character-chat__meta");
  if (metaEl) {
    metaEl.innerHTML = `
      <span>👍 ${c.like_count || 0}</span>
      <span>💬 ${c.chat_count || 0}</span>
      <span>👀 ${c.view_count || 0}</span>
    `;
  }

  // 한 줄 소개
  const summaryEl = document.querySelector(".character-chat__summary");
  if (summaryEl) summaryEl.textContent = c.one_line || "";

  // 상세 패널: 설명
  const descPanel = document.querySelector("#profilePanel .panel__text");
  if (descPanel) descPanel.textContent = c.description || "";

  // 상세 패널: 장르/태깃/해시태그
  const detailRows = document.querySelectorAll("#profilePanel .detail-list__row");

  if (detailRows[0]) detailRows[0].querySelector("dd").textContent = c.genre || "-";
  if (detailRows[1]) detailRows[1].querySelector("dd").textContent = c.target || "-";
  if (detailRows[2]) detailRows[2].querySelector("dd").textContent =
    (c.tags || []).map(t => `#${t}`).join(" ") || "-";

  // 플레이 가이드
  const guideEl = document.querySelector("#guidePanel .panel__text");
  if (guideEl) guideEl.textContent = c.play_guide || "";
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

  data.forEach(msg => {
    chatWindow.appendChild(renderMessage(msg));
  });

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ================================
// 말풍선 렌더
// ================================
function renderMessage(msg) {
  const el = document.createElement("div");
  el.className = "chat-message " + (msg.role === "character" ? "chat-message--character" : "chat-message--user");

  if (msg.role === "character") {
    el.innerHTML = `
      <div class="chat-message__avatar">
        <img src="${document.querySelector('.character-chat__avatar img').src}" />
      </div>
      <div class="chat-message__bubble">
        <div class="chat-message__name">${document.querySelector('.character-chat__name').textContent}</div>
        <div class="chat-message__text">${msg.content}</div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="chat-message__bubble">
        <div class="chat-message__name">나</div>
        <div class="chat-message__text">${msg.content}</div>
      </div>
    `;
  }

  return el;
}

// ================================
// 채팅 전송 기능
// ================================
async function setupChat(characterId) {
  const form = document.getElementById("chatForm");
  const textarea = form.querySelector("textarea");
  const chatWindow = document.getElementById("chatWindow");

  const sessionKey = `cc_session_${characterId}`;
  let sessionId = localStorage.getItem(sessionKey);

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";

    // 사용자 메시지 화면 렌더
    chatWindow.appendChild(renderMessage({ role: "user", content: text }));
    chatWindow.scrollTop = chatWindow.scrollHeight;

      // 서버에 메시지 전송 및 응답 받기
      try {
        const response = await fetch(`/api/characters/${characterId}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sessionId,
            message: text
          })
        });
        const result = await response.json();
        if (response.ok && result.characterMessage) {
          chatWindow.appendChild(renderMessage({
            role: "character",
            content: result.characterMessage.content
          }));
          chatWindow.scrollTop = chatWindow.scrollHeight;
          window.checkChatEmpty();
        } else {
          chatWindow.appendChild(renderMessage({
            role: "character",
            content: "오류가 발생했습니다: " + (result.error || "알 수 없는 오류")
          }));
          chatWindow.scrollTop = chatWindow.scrollHeight;
          window.checkChatEmpty();
        }
      } catch (err) {
        chatWindow.appendChild(renderMessage({
          role: "character",
          content: "서버 연결 오류: " + err.message
        }));
        chatWindow.scrollTop = chatWindow.scrollHeight;
        window.checkChatEmpty();
      }
  });
}

// ================================
// 우측 패널 접기/펼치기 (기본 접힘)
// ================================
document.addEventListener('DOMContentLoaded', () => {
  const sidePanel = document.querySelector('.character-side');
  const sideToggleBtn = document.getElementById('sideToggleBtn');
  let sideCollapsed = true;
  if (sidePanel) sidePanel.classList.add('character-side--collapsed');
  if (sideToggleBtn) {
    sideToggleBtn.innerText = '◀상세정보';
    sideToggleBtn.title = '패널 열기';
    sideToggleBtn.style.display = 'flex';
    sideToggleBtn.addEventListener('click', function() {
      sideCollapsed = !sideCollapsed;
      if (sideCollapsed) {
        sidePanel.classList.add('character-side--collapsed');
        sideToggleBtn.innerText = '◀';
        sideToggleBtn.title = '패널 열기';
      } else {
        sidePanel.classList.remove('character-side--collapsed');
        sideToggleBtn.innerText = '▶';
        sideToggleBtn.title = '패널 닫기';
      }
    });
  }

  // ================================
  // 빈 채팅 안내
  // ================================
  const chatWindow = document.getElementById('chatWindow');
  function checkChatEmpty() {
    if (!chatWindow.querySelector('.chat-message')) {
      chatWindow.classList.add('chat-window--empty');
      chatWindow.innerHTML = '<div>아직 대화가 없습니다.<br>메시지를 입력해 대화를 시작하세요!</div>';
    } else {
      chatWindow.classList.remove('chat-window--empty');
    }
  }
  checkChatEmpty();
  window.checkChatEmpty = checkChatEmpty;

  // 채팅 입력창 하단 고정 및 채팅+입력 합쳐서 100% 높이
  const chatSection = document.querySelector('.character-chat');
  const chatInput = document.querySelector('.chat-input');
  if (chatSection && chatInput) {
    chatSection.style.position = 'relative';
    chatSection.style.height = '100%';
    chatInput.style.position = 'absolute';
    chatInput.style.left = '0';
    chatInput.style.right = '0';
    chatInput.style.bottom = '0';
    chatInput.style.zIndex = '10';
  }
});

// ================================
// 페이지 초기화
// ================================
document.addEventListener("DOMContentLoaded", async () => {
  const characterId = getParam("id");
  if (!characterId) return;

  // DB에서 데이터 가져오기
  const data = await fetchCharacter(characterId);
  if (!data) return;

  renderCharacterDetail(data);
  await loadChatHistory(characterId);
  setupChat(characterId);
});
