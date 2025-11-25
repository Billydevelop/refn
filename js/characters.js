// characters.js

// 간단한 유틸: 캐릭터 카드 렌더
function renderCharacterCard(character) {
  const card = document.createElement('a');
  card.className = 'character-card card';
  card.href = `./character.html?id=${character.id}`;

  card.innerHTML = `
    <div class="character-card__thumb">
      <img src="${character.avatar_url || './assets/sample-character.png'}" alt="${character.name}" />
      ${character.is_monetized ? `
        <div class="character-card__badge character-card__badge--share">
          수익 쉐어
        </div>` : ''}
    </div>
    <div class="character-card__body">
      <div class="character-card__title-row">
        <h2 class="character-card__name">${character.name}</h2>
        <button class="icon-button icon-button--like" aria-label="좋아요">♥</button>
      </div>
      <p class="character-card__summary">
        ${character.one_line || ''}
      </p>
      <div class="character-card__meta">
        <span class="meta-item">👍 ${character.like_count || 0}</span>
        <span class="meta-item">💬 ${character.chat_count || 0}</span>
        <span class="meta-item">👀 ${character.view_count || 0}</span>
      </div>
      <div class="character-card__tags">
        ${(character.tags || []).slice(0, 3).map(t => `<span class="tag">#${t}</span>`).join('')}
      </div>
    </div>
  `;
  return card;
}

// ===== Hero carousel =====
const heroSlidesData = [
  {
    title: '밀리언달러 베이비',
    subtitle: '런던 시계탑 꼭대기에 서는 놈은 나야',
    tags: ['#느와르', '#조직', '#전투'],
    badge: '스토리 추천',
    progress: '4/6',
    image: './assets/sample-character-01.png'
  },
  {
    title: '크랙 EX',
    subtitle: '섬과 죽음의 땅에 발을 내딛은 자들',
    tags: ['#모험', '#생존', '#판타지'],
    badge: '인기 급상승',
    progress: '2/6',
    image: './assets/sample-character-01.png'
  },
  {
    title: '마법 고등 전학생!',
    subtitle: '평범한 일상에 찾아온 마법 같은 하루',
    tags: ['#로맨스', '#학교', '#마법'],
    badge: '오늘 신작',
    progress: '1/4',
    image: './assets/sample-character-01.png'
  }
];

function buildHeroSlides() {
  const container = document.getElementById('heroCarousel');
  if (!container) return;
  container.innerHTML = `
    <article class="hero-slide hero-slide--ghost" data-pos="prev">
      <img src="${heroSlidesData[1].image}" alt="${heroSlidesData[1].title}" />
    </article>
    <article class="hero-slide hero-slide--main" data-pos="main">
      <img src="${heroSlidesData[0].image}" alt="${heroSlidesData[0].title}" />
      <div class="hero-slide__overlay"></div>
      <div class="hero-slide__content"></div>
      <div class="hero-slide__progress"></div>
    </article>
    <article class="hero-slide hero-slide--ghost" data-pos="next">
      <img src="${heroSlidesData[2].image}" alt="${heroSlidesData[2].title}" />
    </article>
  `;
}

function renderHeroContent(data) {
  const mainSlide = document.querySelector('.hero-slide--main');
  if (!mainSlide) return;
  const content = mainSlide.querySelector('.hero-slide__content');
  const progress = mainSlide.querySelector('.hero-slide__progress');
  const img = mainSlide.querySelector('img');
  if (img) img.src = data.image;
  if (img) img.alt = data.title;
  if (progress) progress.textContent = data.progress || '';
  if (content) {
    content.innerHTML = `
      <div class="hero-slide__eyebrow">${data.badge || ''}</div>
      <h1 class="hero-slide__title">${data.title || ''}</h1>
      <p class="hero-slide__subtitle">${data.subtitle || ''}</p>
      <div class="hero-slide__tags">
        ${(data.tags || []).map(t => `<span>${t}</span>`).join('')}
      </div>
    `;
  }
}

function syncSideSlides(prevData, nextData) {
  const prevSlide = document.querySelector('.hero-slide[data-pos="prev"] img');
  const nextSlide = document.querySelector('.hero-slide[data-pos="next"] img');
  if (prevSlide && prevData) {
    prevSlide.src = prevData.image;
    prevSlide.alt = prevData.title;
  }
  if (nextSlide && nextData) {
    nextSlide.src = nextData.image;
    nextSlide.alt = nextData.title;
  }
}

function initHeroCarousel() {
  const container = document.getElementById('heroCarousel');
  if (!container) return;
  if (!heroSlidesData || heroSlidesData.length === 0) return;

  buildHeroSlides();
  let current = 0;
  let timer = null;

  function updateSlides() {
    const prev = (current - 1 + heroSlidesData.length) % heroSlidesData.length;
    const next = (current + 1) % heroSlidesData.length;
    renderHeroContent(heroSlidesData[current]);
    syncSideSlides(heroSlidesData[prev], heroSlidesData[next]);
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      current = (current + 1) % heroSlidesData.length;
      updateSlides();
    }, 6000);
  }

  updateSlides();
  startTimer();

  const prevBtn = document.getElementById('heroPrev');
  const nextBtn = document.getElementById('heroNext');

  const goPrev = () => {
    current = (current - 1 + heroSlidesData.length) % heroSlidesData.length;
    updateSlides();
    startTimer();
  };

  const goNext = () => {
    current = (current + 1) % heroSlidesData.length;
    updateSlides();
    startTimer();
  };

  if (prevBtn) prevBtn.addEventListener('click', goPrev);
  if (nextBtn) nextBtn.addEventListener('click', goNext);

  container.addEventListener('touchstart', (e) => {
    const touchStartX = e.touches[0].clientX;
    const touchHandler = (moveEvent) => {
      const deltaX = moveEvent.touches[0].clientX - touchStartX;
      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          goPrev();
        } else {
          goNext();
        }
        container.removeEventListener('touchmove', touchHandler);
      }
    };
    container.addEventListener('touchmove', touchHandler);
  });
}

async function loadCharacters() {
  const listEl = document.querySelector('.characters-grid');
  if (!listEl) return;

  listEl.textContent = '로딩 중...';

  // ★ supabase → sb 로 교체
  // ★ public 스키마의 characters 테이블 조회
  const { data, error } = await sb
    .from('characters')
    .select('*')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(error);
    listEl.innerHTML = '<div>캐릭터를 불러오는 중 오류가 발생했습니다.</div>';
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = '<div>아직 캐릭터가 없습니다.</div>';
    return;
  }

  listEl.innerHTML = '';
  data.forEach(ch => listEl.appendChild(renderCharacterCard(ch)));
}

// DOM 로드 후 실행
document.addEventListener('DOMContentLoaded', () => {
  initHeroCarousel();
  loadCharacters();

  const createBtn = document.getElementById('createCharacterBtn');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      window.location.href = './create-character.html';
    });
  }
});
