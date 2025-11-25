// js/works.js

document.addEventListener("DOMContentLoaded", () => {
  initWorksPage();
});

async function initWorksPage() {
  // 로그인 체크
  const { data, error } = await window.sb.auth.getSession();
  if (error || !data.session) {
    window.location.href = "login.html";
    return;
  }

  const filterButtons = document.querySelectorAll(".works-filter-btn");
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const kind = btn.getAttribute("data-kind") || "all";
      renderWorks(kind);
    });
  });

  // 최초 전체 보기
  renderWorks("all");
}

async function fetchUserContents() {
  try {
    const { data: sessionData, error: sessionError } =
      await window.sb.auth.getSession();
    if (sessionError || !sessionData.session) return [];

    const userId = sessionData.session.user.id;

    const { data, error } = await window.sb
      .from("user_contents")
      .select("id, kind, title, prompt, thumb_url, full_url, created_at, service_code")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("user_contents fetch error", error);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error("fetchUserContents error", e);
    return [];
  }
}

async function renderWorks(kindFilter = "all") {
  const grid = document.getElementById("worksGrid");
  const empty = document.getElementById("worksEmpty");
  grid.innerHTML = "";

  const allRows = await fetchUserContents();

  const rows = allRows.filter((row) => {
    if (kindFilter === "all") return true;
    return row.kind === kindFilter;
  });

  if (!rows.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "work-card";

    const thumb = document.createElement("div");
    thumb.className = "work-thumb";
    if (row.kind === "image" && row.thumb_url) {
      const img = document.createElement("img");
      img.src = row.thumb_url;
      img.alt = row.title || "image";
      thumb.appendChild(img);
    } else {
      thumb.textContent = row.kind === "chat" ? "💬 채팅" : "📄 콘텐츠";
    }

    const body = document.createElement("div");
    body.className = "work-body";

    const titleEl = document.createElement("div");
    titleEl.className = "work-title";
    titleEl.textContent =
      row.title ||
      (row.prompt &&
        row.prompt.slice(0, 24) +
          (row.prompt.length > 24 ? "..." : "")) ||
      "작업물";

    const metaEl = document.createElement("div");
    metaEl.className = "work-meta";
    const dateText = row.created_at
      ? new Date(row.created_at).toLocaleString("ko-KR")
      : "";
    metaEl.textContent = `${row.service_code || ""} · ${dateText}`;

    body.appendChild(titleEl);
    body.appendChild(metaEl);

    const actions = document.createElement("div");
    actions.className = "work-actions";

    const openBtn = document.createElement("button");
    openBtn.textContent = "열기";
    openBtn.addEventListener("click", () => {
      if (row.kind === "image" && row.full_url) {
        window.open(row.full_url, "_blank");
      } else if (row.kind === "chat") {
        window.location.href = "index.html";
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", async () => {
      const ok = confirm("이 작업물을 목록에서 숨기시겠어요?");
      if (!ok) return;

      const { error } = await window.sb
        .from("user_contents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", row.id);

      if (error) {
        console.error("user_contents delete error", error);
        alert("삭제 중 오류가 발생했습니다.");
        return;
      }

      renderWorks(kindFilter);
    });

    actions.appendChild(openBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(thumb);
    card.appendChild(body);
    card.appendChild(actions);

    grid.appendChild(card);
  });
}
