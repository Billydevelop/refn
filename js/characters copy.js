// characters.js

// 캐릭터 카드 렌더링
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

async function loadCharacters() {
  const listEl = document.querySelector('.characters-grid');
  if (!listEl) return;

  listEl.textContent = '로딩 중...';

  // public.characters 테이블에서 공개 캐릭터 조회
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
/* ===== 히어로 슬라이더 ===== */
document.addEventListener('DOMContentLoaded', () => {
  const track = document.querySelector('.hero-slider__track');
  if (!track) return;

  const slides = document.querySelectorAll('.hero-slide');
  const prevBtn = document.querySelector('.hero-slider__btn--prev');
  const nextBtn = document.querySelector('.hero-slider__btn--next');

  let index = 0;
  const total = slides.length;

  function updateSlider() {
    track.style.transform = `translateX(-${index * 100}%)`;
  }

  nextBtn.addEventListener('click', () => {
    index = (index + 1) % total;
    updateSlider();
  });

  prevBtn.addEventListener('click', () => {
    index = (index - 1 + total) % total;
    updateSlider();
  });

  /* 터치 스와이프 지원 */
  let startX = 0;
  track.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  });

  track.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].clientX - startX;
    if (Math.abs(diff) > 50) {
      if (diff < 0) nextBtn.click();
      else prevBtn.click();
    }
  });
});

// DOM 로드 후 실행
document.addEventListener('DOMContentLoaded', () => {
  loadCharacters();

  const createBtn = document.getElementById('createCharacterBtn');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      window.location.href = './create-character.html';
    });
  }
});
