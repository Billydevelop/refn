// js/mypage.js

document.addEventListener("DOMContentLoaded", () => {
  initMyPage();
});

async function initMyPage() {
  // 1) 세션 체크: 비로그인 → 로그인 페이지
  const { data, error } = await window.sb.auth.getSession();
  if (error || !data.session) {
    window.location.href = "login.html";
    return;
  }

  // 2) 공통 컨텍스트 가져오기 (common.js 에서 만든 함수 재사용)
  let ctx;
  try {
    ctx = await window.fetchUserContext(); // { user, profile, wallet, subscription }
  } catch (e) {
    console.error("fetchUserContext error", e);
  }

  if (!ctx) {
    alert("계정 정보를 불러오지 못했습니다. 다시 로그인해주세요.");
    window.location.href = "login.html";
    return;
  }

  const { user, profile, wallet, subscription } = ctx;

  // 3) 뷰모델 만들기
  const vm = buildProfileViewModel({ user, profile, wallet, subscription });

  // 4) DOM에 바인딩
  bindProfileToDom(vm);

  // 5) 버튼 이벤트
  setupMyPageActions();
}

function buildProfileViewModel({ user, profile, wallet, subscription }) {
  const displayName =
    profile?.display_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "사용자";

  const handle =
    profile?.handle ||
    user.user_metadata?.user_name ||
    (user.email ? user.email.split("@")[0] : null);

  const joinedAt = profile?.joined_at || user.created_at;
  const joinedText = joinedAt
    ? new Date(joinedAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";

  const planName = subscription?.plans?.name || "무료";

  const credits = wallet?.balance ?? profile?.current_credits ?? 0;

  return {
    displayName,
    handle,
    joinedText,
    planName,
    credits,
    // 추가 정보
    bio: profile?.bio || "",
    website: profile?.website || "",
    job: profile?.job || "",
    gender: profile?.gender || "",
    ageRange: profile?.age_range || "",
  };
}

function safeText(value, fallback = "정보 없음") {
  if (!value || !String(value).trim()) return fallback;
  return value;
}

function bindProfileToDom(vm) {
  const avatarCircle = document.getElementById("profileAvatarCircle");
  const displayNameEl = document.getElementById("profileDisplayName");
  const handleEl = document.getElementById("profileHandle");
  const joinedAtEl = document.getElementById("profileJoinedAt");
  const nicknameEl = document.getElementById("profileNickname");
  const planEl = document.getElementById("profilePlan");
  const creditsEl = document.getElementById("profileCredits");

  const bioEl = document.getElementById("profileBio");
  const websiteEl = document.getElementById("profileWebsite");
  const jobEl = document.getElementById("profileJob");
  const genderEl = document.getElementById("profileGender");
  const ageRangeEl = document.getElementById("profileAgeRange");

  const shortName =
    vm.displayName.length <= 2
      ? vm.displayName
      : vm.displayName.slice(-2);

  if (avatarCircle) {
    avatarCircle.textContent = shortName;
    avatarCircle.title = vm.displayName;
  }

  if (displayNameEl) displayNameEl.textContent = vm.displayName;
  if (handleEl) handleEl.textContent = vm.handle ? `@${vm.handle}` : "";
  if (joinedAtEl) joinedAtEl.textContent = vm.joinedText;
  if (nicknameEl) nicknameEl.textContent = vm.handle || vm.displayName;
  if (planEl) planEl.textContent = vm.planName;
  if (creditsEl) creditsEl.textContent = vm.credits.toLocaleString("ko-KR");

  if (bioEl) bioEl.textContent = safeText(vm.bio);
  if (websiteEl) websiteEl.textContent = safeText(vm.website);
  if (jobEl) jobEl.textContent = safeText(vm.job);
  if (genderEl) genderEl.textContent = safeText(vm.gender);
  if (ageRangeEl) ageRangeEl.textContent = safeText(vm.ageRange);
}

function setupMyPageActions() {
  const logoutBtn = document.getElementById("profileLogoutBtn");
  const deleteBtn = document.getElementById("profileDeleteBtn");
  const buyCreditsBtn = document.getElementById("buyCreditsBtn");
  const editBtn = document.getElementById("editProfileBtn");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await window.sb.auth.signOut();
      window.location.href = "login.html";
    });
  }

  if (buyCreditsBtn) {
    buyCreditsBtn.addEventListener("click", () => {
      // TODO: 실제 크레딧 구매 페이지로 연결
      alert("크레딧 구매 기능은 추후 연결 예정입니다.");
    });
  }

  if (editBtn) {
    editBtn.addEventListener("click", () => {
      alert("프로필 수정 기능은 아직 준비 중입니다.");
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      alert(
        "계정 영구 삭제는 보안상 서버(관리자)에서만 가능하게 구현해야 합니다.\n" +
          "별도의 백엔드/Edge Function에서 구현해 주세요."
      );
    });
  }
}
