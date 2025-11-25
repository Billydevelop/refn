// authWidget.js

// HTML상에서 로그인 UI가 들어갈 div를 찾는다
const authArea = document.getElementById("authArea");

// 페이지에 authArea가 없으면 무시
if (authArea) {
  initAuthWidget();
}

async function initAuthWidget() {
  // 현재 로그인 세션 가져오기
  const { data, error } = await window.sb.auth.getSession();

  if (data.session) {
    // 로그인 상태일 때 ###########
    renderLoggedIn(data.session.user);
  } else {
    // 로그아웃 상태 ###########
    renderLoggedOut();
  }
}

function renderLoggedOut() {
  authArea.innerHTML = `
    <button id="loginBtn" class="login-btn">구글로 로그인</button>
  `;

  document.getElementById("loginBtn").addEventListener("click", async () => {
    const { error } = await window.sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) alert(error.message);
  });
}

function renderLoggedIn(user) {
  authArea.innerHTML = `
    <span>${user.user_metadata.name || user.email}</span>
    <button id="logoutBtn" class="logout-btn">로그아웃</button>
  `;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await window.sb.auth.signOut();
    location.reload();
  });
}
