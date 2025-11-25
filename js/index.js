// js/index.js
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".banner-dot").forEach((dot, idx, dots) => {
    dot.addEventListener("click", () => {
      dots.forEach((d) => d.classList.remove("active"));
      dot.classList.add("active");
    });
  });

  // 필요하면 여기 추가...
});





// js/index.js

document.addEventListener('DOMContentLoaded', async () => {
  const loginStatusEl = document.getElementById('loginStatus');

  if (!window.sb) {
    console.error('Supabase 클라이언트가 없습니다. common.js에서 초기화를 확인하세요.');
    if (loginStatusEl) loginStatusEl.textContent = '오류: Supabase 초기화 실패';
    return;
  }

  // 🔹 현재 세션 가져오기
  const { data, error } = await window.sb.auth.getSession();

  if (error) {
    console.error('세션 확인 에러:', error);
    if (loginStatusEl) loginStatusEl.textContent = '로그인 상태 확인 실패';
    return;
  }

  if (data.session) {
    // ✅ 로그인 되어있는 상태
    const user = data.session.user;
    const name =
      user.user_metadata?.name ||
      user.user_metadata?.full_name ||
      user.email ||
      '로그인 유저';

    if (loginStatusEl) {
      loginStatusEl.innerHTML = `
        <span>${name}님</span>
        <button id="logoutBtn" style="margin-left:8px;">로그아웃</button>
      `;
    }

    // 로그아웃 버튼 이벤트
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await window.sb.auth.signOut();
        // 로그아웃 후 새로고침
        window.location.reload();
      });
    }

    // 👉 여기서부터는 로그인된 유저만 이용 가능한 데이터 로딩 등 해도 됨
    // ex) loadUserData(user.id);

  } else {
    // ❌ 로그인 안 되어있는 상태
    if (loginStatusEl) {
      loginStatusEl.innerHTML = `
        <button id="goLoginBtn">로그인</button>
      `;
    }

    const goLoginBtn = document.getElementById('goLoginBtn');
    if (goLoginBtn) {
      goLoginBtn.addEventListener('click', async () => {
        // 로그인 페이지로 보내거나, 바로 구글 로그인 시도
        // 예: 구글 OAuth 바로 시작
        const { error } = await window.sb.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin  // ex) https://refn.com 또는 http://localhost:5500
          }
        });
        if (error) {
          alert('로그인 실패: ' + error.message);
        }
      });
    }
  }
});
