const state = {
  baseImage: null,
  refImage: null,
  resultImage: null,
};

const DEFAULT_REPLACE_PROMPT =
  'Replace only the specified clothing/accessories (e.g., tops, bottoms, watch). Keep the original person, pose, face, hair, hands, skin tone, shoes, lighting, and background identical to the base image. Do not modify any region that is not explicitly mentioned. Use the reference image if provided for style.';

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  const el = $('statusBar');
  if (el) el.textContent = msg;
}

async function getAuthHeader() {
  try {
    if (!window.sb) return null;
    const { data, error } = await window.sb.auth.getSession();
    if (error || !data?.session?.access_token) return null;
    return { Authorization: `Bearer ${data.session.access_token}` };
  } catch (e) {
    return null;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function downscaleDataUrl(dataUrl, target = 1024) {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = dataUrl;
  });
  // Fit into square canvas (target x target) to satisfy Stability allowed sizes
  const scale = Math.min(target / img.width, target / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  const dx = (target - w) / 2;
  const dy = (target - h) / 2;
  ctx.clearRect(0, 0, target, target);
  ctx.drawImage(img, dx, dy, w, h);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function attachFileInputs() {
  const baseInput = $('baseUpload');
  const refInput = $('refUpload');

  baseInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    state.baseImage = dataUrl;
    $('basePreview').src = dataUrl;
    setStatus('원본을 불러왔습니다. 레퍼런스를 선택하거나 바로 생성하세요.');
  });

  refInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    state.refImage = dataUrl;
    $('refPreview').src = dataUrl;
    setStatus('레퍼런스 의상 이미지를 불러왔습니다.');
  });
}

async function generateOutfit() {
  if (!state.baseImage) {
    setStatus('원본 이미지를 먼저 업로드하세요.');
    return;
  }

  const authHeader = await getAuthHeader();
  if (!authHeader) {
    setStatus('로그인 후 이용해주세요. (세션 없음)');
    return;
  }

  const garments = $('promptInput').value.trim();
  const prompt =
    garments.length > 0
      ? `${DEFAULT_REPLACE_PROMPT}\nTarget outfits: ${garments}`
      : DEFAULT_REPLACE_PROMPT;

  setStatus('OpenAI 이미지로 의상 교체 중...');
  $('generateBtn').disabled = true;

  try {
    const body = {
      baseImage: await downscaleDataUrl(state.baseImage, 1024),
      refImage: state.refImage ? await downscaleDataUrl(state.refImage, 1024) : null,
      prompt,
    };

    const resp = await fetch('/api/fashion/replace-outfit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.message || '서버 오류');
    }

    const json = await resp.json();
    const src = json.dataUrl || json.imageUrl;
    if (!src) throw new Error('생성 이미지가 없습니다.');

    state.resultImage = src;
    $('resultPreview').src = src;
    setStatus('의상 교체가 완료되었습니다.');
  } catch (err) {
    console.error(err);
    setStatus(`생성 실패: ${err.message}`);
  } finally {
    $('generateBtn').disabled = false;
  }
}

function bindActions() {
  $('generateBtn')?.addEventListener('click', generateOutfit);
  $('resetBtn')?.addEventListener('click', () => {
    state.baseImage = null;
    state.refImage = null;
    state.resultImage = null;
    $('basePreview').src = '';
    $('refPreview').src = '';
    $('resultPreview').src = '';
    $('baseUpload').value = '';
    $('refUpload').value = '';
    $('promptInput').value = '';
    setStatus('입력값을 초기화했습니다.');
  });
}

function initFashionPage() {
  attachFileInputs();
  bindActions();
  $('promptInput').placeholder = '예) red leather jacket, denim wide pants, black combat boots';
  setStatus('원본 이미지를 업로드해 시작하세요.');
}

document.addEventListener('DOMContentLoaded', initFashionPage);
