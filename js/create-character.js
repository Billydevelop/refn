// create-character.js
// - 스텝 이동
// - 미리보기(이름/이미지)
// - Supabase(sb)로 캐릭터 저장

// ---------- 공통 유틸 ----------

// 현재 로그인 유저 가져오기
async function getCurrentUser() {
    if (typeof window.sb === 'undefined') {
        console.error('Supabase 클라이언트(window.sb)가 없습니다. common.js 로드 순서를 확인하세요.');
        return null;
    }

    const { data, error } = await window.sb.auth.getSession();
    if (error || !data || !data.session) return null;
    return data.session.user;
}

// 특정 스텝으로 이동
function goStep(stepId) {
    const stepTabs = document.querySelectorAll('.steps-nav__item');
    const steps = document.querySelectorAll('.step');

    stepTabs.forEach(btn => {
        const active = btn.dataset.step === stepId;
        btn.classList.toggle('steps-nav__item--active', active);
    });

    steps.forEach(step => {
        step.classList.toggle('step--active', step.id === stepId);
    });
}

// 폼 데이터 수집
function collectCharacterForm() {
    // STEP 1: 기본 정보
    const basic = document.getElementById('step-basic');
    const basicTextInputs = basic.querySelectorAll('input.field__control[type="text"]');
    const name = basicTextInputs[0] ? basicTextInputs[0].value.trim() : '';
    const oneLine = basicTextInputs[1] ? basicTextInputs[1].value.trim() : '';

    // STEP 2: 인트로 / 예시 / 가이드
    const introStep = document.getElementById('step-intro');
    const introTextareas = introStep.querySelectorAll('textarea.field__control');
    const intro = introTextareas[0] ? introTextareas[0].value.trim() : '';
    const exampleDialog = introTextareas[1] ? introTextareas[1].value.trim() : '';
    const playGuide = introTextareas[2] ? introTextareas[2].value.trim() : '';

    // STEP 3: 프롬프트
    const promptStep = document.getElementById('step-prompt');
    const promptTextarea = promptStep.querySelector('textarea.field__control');
    const prompt = promptTextarea ? promptTextarea.value.trim() : '';

    // STEP 5: 상세
    const detail = document.getElementById('step-detail');
    const detailTextareas = detail.querySelectorAll('textarea.field__control');
    const description = detailTextareas[0] ? detailTextareas[0].value.trim() : '';

    const selects = detail.querySelectorAll('select.field__control');
    const genre = selects[0] ? selects[0].value : '';
    const target = selects[1] ? selects[1].value : '';

    const hashtagInput = detail.querySelector('input.field__control[type="text"]');
    const tagRaw = hashtagInput ? hashtagInput.value : '';
    const tags = tagRaw
        ? tagRaw
            .split(/[, ]+/)
            .map(t => t.trim())
            .filter(Boolean)
            .slice(0, 10)
        : [];

    const visibilityRadio = detail.querySelector('input[name="visibility"]:checked');
    const visibility = visibilityRadio ? visibilityRadio.value : 'public';

    const toggleCheckboxes = detail.querySelectorAll('.toggle input[type="checkbox"]');
    const isMonetized = toggleCheckboxes[0] ? toggleCheckboxes[0].checked : false;
    const commentsEnabled = toggleCheckboxes[1]
        ? toggleCheckboxes[1].checked
        : true;

    return {
        name,
        oneLine,
        intro,
        exampleDialog,
        playGuide,
        prompt,
        description,
        genre,
        target,
        tags,
        visibility,
        isMonetized,
        commentsEnabled
    };
}

const AVATAR_BUCKET = 'character_profile';  // 🔴 여기: Supabase Storage에서 실제 버킷 이름으로 바꾸기


async function handleSubmitCharacter() {
  const user = await getCurrentUser();
  if (!user) {
    alert('로그인이 필요합니다.');
    return;
  }

  const form = collectCharacterForm();

  // 필수값 체크 (지금 쓰던 거 그대로)
  if (!form.name) { alert('캐릭터 이름을 입력해 주세요.'); goStep('step-basic'); return; }
  if (!form.oneLine) { alert('한 줄 소개를 입력해 주세요.'); goStep('step-basic'); return; }
  if (!form.intro) { alert('인트로를 입력해 주세요.'); goStep('step-intro'); return; }
  if (!form.prompt) { alert('캐릭터 프롬프트를 입력해 주세요.'); goStep('step-prompt'); return; }
  if (!form.description) { alert('캐릭터 설명을 입력해 주세요.'); goStep('step-detail'); return; }

  // 1) 이미지 파일
  const imageInput = document.getElementById('characterImage');
  let avatarUrl = null;

  if (imageInput && imageInput.files && imageInput.files[0]) {
    const file = imageInput.files[0];
    const ext = file.name.split('.').pop();
    const fileName = `${user.id}_${Date.now()}.${ext}`;
    const filePath = `avatars/${fileName}`;

    const { error: uploadError } = await sb.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('아바타 업로드 실패:', uploadError);
      alert('이미지 업로드 중 오류가 발생했습니다. (콘솔 로그 참고)');
    } else {
      const { data: publicData } = sb.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);
      avatarUrl = publicData.publicUrl;
    }
  }

  const payload = {
    owner_id: user.id,
    name: form.name,
    one_line: form.oneLine,
    intro: form.intro,
    play_guide: form.playGuide || null,
    prompt: form.prompt,
    description: form.description,
    genre: form.genre || null,
    target: form.target || null,
    tags: form.tags,
    visibility: form.visibility,
    is_monetized: form.isMonetized,
    comment_enabled: form.commentsEnabled,
    avatar_url: avatarUrl
  };

  const { data, error } = await sb
    .from('characters')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error(error);
    alert('캐릭터 생성 중 오류가 발생했습니다.');
    return;
  }

  alert('캐릭터가 생성되었습니다.');
  window.location.href = `./character.html?id=${data.id}`;
}

// ---------- DOM 초기화 ----------

document.addEventListener('DOMContentLoaded', () => {
    // 스텝 탭
    document.querySelectorAll('.steps-nav__item').forEach(btn => {
        btn.addEventListener('click', () => {
            const stepId = btn.dataset.step;
            if (stepId) goStep(stepId);
        });
    });

    // 다음/이전
    document.querySelectorAll('.step-next').forEach(btn => {
        btn.addEventListener('click', () => {
            const next = btn.dataset.next;
            if (next) goStep(next);
        });
    });
    document.querySelectorAll('.step-prev').forEach(btn => {
        btn.addEventListener('click', () => {
            const prev = btn.dataset.prev;
            if (prev) goStep(prev);
        });
    });

    // 이름 → 미리보기 이름
    const basic = document.getElementById('step-basic');
    if (basic) {
        const textInputs = basic.querySelectorAll('input.field__control[type="text"]');
        const nameInput = textInputs[0];
        const previewName = document.getElementById('previewName');

        if (nameInput && previewName) {
            nameInput.addEventListener('input', () => {
                previewName.textContent = nameInput.value || '캐릭터 이름';
            });
        }

        // 이미지 → 미리보기 이미지
        const imageInput = document.getElementById('characterImage');
        const previewImage = document.getElementById('previewImage');
        if (imageInput && previewImage) {
            imageInput.addEventListener('change', e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    previewImage.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            });
        }
    }

    // 상단 "등록하기" 버튼
    const submitTopBtn = document.getElementById('submitCharacter');
    if (submitTopBtn) submitTopBtn.addEventListener('click', handleSubmitCharacter);

    // 마지막 스텝의 "등록" 버튼
    const finalSubmitBtn = document.querySelector(
        '#step-detail .step__footer .btn.btn--primary'
    );
    if (finalSubmitBtn) finalSubmitBtn.addEventListener('click', handleSubmitCharacter);
});
