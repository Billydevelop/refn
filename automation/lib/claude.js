import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용

const RESEARCH_MODEL = process.env.RESEARCH_MODEL || 'claude-opus-4-8';
const WRITE_MODEL = process.env.WRITE_MODEL || 'claude-sonnet-4-6';

/**
 * 푸시 알림용 후킹 한 줄 카피 — 클릭 유도(궁금증 유발), 낚시·과장 금지.
 */
export async function generatePushHook({ title, description }) {
  try {
    const resp = await client.messages.create({
      model: WRITE_MODEL,
      max_tokens: 120,
      system:
        '너는 푸시 알림 카피라이터다. 주어진 글을 열어보고 싶게 만드는 후킹한 한 줄을 만든다. ' +
        '궁금증을 유발하되 낚시·과장·허위는 금지. 28자 이내, 이모지는 0~1개만, 따옴표 없이 한 줄만 출력.',
      messages: [{ role: 'user', content: `제목: ${title}\n요약: ${description || ''}\n\n이 글의 푸시 알림 후킹 카피 한 줄:` }],
    });
    const txt = (resp.content?.find((c) => c.type === 'text')?.text || '')
      .trim().replace(/^["'`]+|["'`]+$/g, '').split('\n')[0].trim();
    return txt || title;
  } catch (e) {
    return title; // 실패 시 제목 폴백
  }
}

/**
 * 스레드(Threads) 배포용 드래프트 — "오늘의 이슈, 돈으로 읽다" 보이스. 복붙용(자동 게시 X).
 */
export async function generateThreadsDraft({ title, description, url }) {
  try {
    const resp = await client.messages.create({
      model: WRITE_MODEL,
      max_tokens: 700,
      system:
        '너는 스레드(Threads) 카피라이터다. 크라마의 보이스: "오늘의 이슈를 돈 관점으로 풀어준다". ' +
        '주어진 글을 스레드에 바로 올릴 한국어 포스트로 바꾼다. 규칙: ' +
        '1) 첫 줄은 스크롤을 멈추게 하는 훅(궁금증·숫자·반전). ' +
        '2) 3~6줄, 한 줄씩 짧게, 줄바꿈을 적극 사용. ' +
        '3) 핵심을 "이게 내 돈에 무슨 의미인지"로 풀 것. ' +
        '4) 낚시·과장·허위 금지, 사실 기반. ' +
        '5) 마지막에 "전문 👉 " + 링크 한 줄, 그 아래 해시태그 2~3개. ' +
        '6) 이모지 절제(0~3개). 머리말/따옴표 없이 포스트 본문만 출력.',
      messages: [{ role: 'user', content: `제목: ${title}\n요약: ${description || ''}\n링크: ${url}\n\n스레드 포스트 초안:` }],
    });
    return (resp.content?.find((c) => c.type === 'text')?.text || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * 예측 게임(오르까 내리까) 주간 판정 촌평 — 결과 리빌에 붙는 크라미의 한 마디.
 * summary: { week, items: [{label, changePct, dir, crowdUpPct}], participants, perfectCount }
 */
export async function generatePredictionCommentary(summary) {
  const lines = summary.items
    .map((it) => `- ${it.label}: ${it.changePct > 0 ? '+' : ''}${it.changePct}% (${it.dir === 'push' ? '무승부' : it.dir === 'up' ? '상승' : '하락'}, 참여자 ${it.crowdUpPct}%가 상승에 베팅)`)
    .join('\n');
  const resp = await client.messages.create({
    model: WRITE_MODEL,
    max_tokens: 300,
    system:
      '너는 금융 예측 게임의 결과 발표 코멘테이터 "크라미"(귀여운 미어캣 마스코트)다. ' +
      '한 주 결과를 재치 있게 총평한다. 규칙: ' +
      '1) 2~3문장, 전체 140자 이내. ' +
      '2) 다수파가 틀렸으면 그 반전을, 맞혔으면 싱거움을 유쾌하게 짚기. 퍼펙트 달성자가 있으면 축하. ' +
      '3) 시장 전망·매수매도 권유·다음 주 예측 금지(지난 결과 얘기만). ' +
      '4) 친근한 존댓말. 비속어·거친 표현 금지(허를 찔렀다/뒤통수/배신 정도는 OK). 이모지 금지, 따옴표 없이 본문만 출력.',
    messages: [{
      role: 'user',
      content: `${summary.week} 라운드 결과:\n${lines}\n참여 ${summary.participants}명, 전원 적중(퍼펙트) ${summary.perfectCount}명.\n\n결과 발표 촌평:`,
    }],
  });
  return (resp.content?.find((c) => c.type === 'text')?.text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
}

/**
 * 1) 리서치 — web_search 로 상위 콘텐츠 트렌드·검색의도·커버리지 갭 분석.
 *    원문 복제 금지, 구조/각도/키워드만 추출.
 */
// 프롬프트에 현재 시점을 명시하지 않으면 모델이 학습 시점 연도를 쓴다.
// 실제로 2026-08 발행분 제목이 "2024 AI 툴 리뷰", "2025 직장인 부업 가이드"로 나와
// 홈 최상단에 지난 연도 글처럼 노출됐다. 모든 생성 단계에 오늘 날짜를 주입한다.
function todayKo() {
  const d = new Date();
  return {
    year: d.getFullYear(),
    full: `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`,
  };
}

export async function research({ topic, keywords }) {
  const { year, full } = todayKo();
  const system =
    `오늘은 ${full}이다. 조사와 서술의 기준 시점은 ${year}년이며, 과거 연도를 현재처럼 쓰지 마라. ` +
    '너는 한국어 콘텐츠 전략가다. 주어진 주제를 웹에서 조사해, 상위 노출 글들이 공통으로 다루는 소주제, ' +
    '검색자의 의도, 아직 충분히 다뤄지지 않은 차별화 포인트(커버리지 갭)를 정리한다. ' +
    '절대 특정 글의 문장이나 표현을 복제하지 말고, 사실·구조·각도만 요약한다. 한국어로 답한다.';

  let messages = [
    {
      role: 'user',
      content:
        `주제: ${topic}\n관련 키워드: ${(keywords || []).join(', ')}\n\n` +
        '이 주제로 신규 원본 글을 쓰기 위한 리서치 브리프를 작성해줘. 다음을 포함:\n' +
        '- 핵심 검색 의도 1~2줄\n- 반드시 다뤄야 할 H2 소주제 5~7개\n' +
        '- 흔한 오해나 초보가 헷갈리는 지점\n- 경쟁 글이 잘 안 다루는 차별화 포인트\n' +
        '- 자연스럽게 녹일 키워드 목록',
    },
  ];

  let resp;
  for (let i = 0; i < 5; i++) {
    resp = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 4000,
      system,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages,
    });
    // 서버측 도구가 반복 한도에 도달하면 pause_turn — 그대로 재요청해 이어가기
    if (resp.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: resp.content }];
      continue;
    }
    break;
  }
  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * 2) 작성 — 리서치 브리프 기반으로 완전 원본 SEO 글을 MDX 본문으로 생성.
 *    구조화 출력으로 title/description/tags/slug/body 반환.
 */
export async function writeArticle({ brief, cluster, categoryName, lang = 'ko' }) {
  // --- 1) 본문: 자유 텍스트(MDX)로 길게 생성 (구조화출력에 욱여넣지 않음) ---
  const { year, full } = todayKo();
  const system =
    `오늘은 ${full}이다. 모든 서술의 현재 시점은 ${year}년이다. ` +
    `너는 "${categoryName}" 분야의 전문 에디터다. 한국어로 깊이 있고 정확한 SEO 원본 글을 쓴다. ` +
    '다른 매체의 문장을 복제하지 않으며, 실전에 바로 쓰이는 구체적 정보와 예시를 담는다.';

  const rules = [
    '분량: 한국어 2,000~3,500자 (충분히 길게).',
    '구조: 도입 문단 → ## H2 5~7개(필요시 ### H3) → 마무리. 제목(# H1)은 쓰지 말 것(frontmatter가 담당).',
    '본문 맨 앞에 <KeyTakeaways items={["...","..."]} /> 로 핵심 3~4개 요약.',
    '중요한 팁/주의는 <Callout type="tip">내용</Callout> (type: tip|warn|info).',
    '단계형 가이드가 어울리면 <Checklist id="고유영문id" title="..." items={["...","..."]} /> 삽입.',
    '마지막에 <FAQ items={[{ q: "질문", a: "답변" }]} /> 로 4개 내외 FAQ.',
    'import 문은 쓰지 말 것(발행 시 자동 삽입).',
    'JSX 속성값의 따옴표/중괄호가 깨지지 않게 유효한 MDX로 작성. 큰따옴표 안의 큰따옴표 금지.',
    '과장·허위 금지. 투자 주제면 정보 제공 목적임을 자연스럽게 전제.',
    '출력은 MDX 본문만. 코드펜스(```)나 설명 문구 없이 바로 본문부터.',
  ].join('\n- ');

  const bodyResp = await client.messages.create({
    model: WRITE_MODEL,
    max_tokens: 8000,
    system,
    messages: [
      {
        role: 'user',
        content:
          `세부 주제(클러스터): ${cluster}\n\n[리서치 브리프]\n${brief}\n\n` +
          `위 브리프를 바탕으로 완전 원본 글을 작성해줘.\n규칙:\n- ${rules}`,
      },
    ],
  });
  let body = bodyResp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  // 혹시 모를 코드펜스/선두 H1 제거
  body = body.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  body = body.replace(/^#\s+.+\n+/, '');

  // --- 2) 메타데이터: 본문 기반 작은 구조화 출력 ---
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      slug: { type: 'string', description: 'SEO용 영문 kebab-case 슬러그' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'description', 'slug', 'tags'],
    additionalProperties: false,
  };
  const metaResp = await client.messages.create({
    model: WRITE_MODEL,
    max_tokens: 800,
    system:
      `오늘은 ${todayKo().full}이다. ` +
      '너는 SEO 메타데이터 생성기다. 한국어 제목(검색 친화적, 30자 내외)과 설명(120자 내외), 영문 kebab-case 슬러그, 태그 4~6개를 만든다. ' +
      // 연도를 박으면 이듬해에 곧바로 낡아 보인다. 롱테일 유입이 주력이므로 기본은 연도 없는 제목.
      `제목·슬러그에 연도를 넣지 마라. 연도가 의미의 핵심인 주제(제도 개편 등)일 때만 ${todayKo().year}를 쓰고, 과거 연도는 절대 쓰지 마라.`,
    messages: [
      {
        role: 'user',
        content: `다음 글의 메타데이터를 만들어줘. 제목은 본문 주제를 정확히 반영.\n\n${body.slice(0, 3000)}`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema } },
  });
  const meta = JSON.parse(metaResp.content.find((b) => b.type === 'text')?.text || '{}');

  return { ...meta, body };
}

/** 이미지 생성용 영문 프롬프트 — 글 주제에 맞는 실사 사진(유튜브 썸네일 배경용) */
export async function imagePrompt({ title, categoryName }) {
  const resp = await client.messages.create({
    model: WRITE_MODEL,
    max_tokens: 300,
    system:
      'You write a concise English prompt for a NEWS/EDITORIAL thumbnail image (the kind used on news articles). ' +
      'It should look like an authentic press photo or a clean conceptual still-life — NOT necessarily containing a person. Prefer a clear, symbolic real-world subject when fitting: an everyday object, document, money/cards, a building or street, tools, hands, or an ordinary interior. ' +
      'Style: realistic photojournalism (full-frame DSLR, natural light, true-to-life texture, subtle grain) OR a restrained editorial photo-composite; cool/neutral color grade with deep navy shadows; slightly imperfect, not staged or glossy. ' +
      'Keep the lower and left area darker and uncluttered so bold headline text can be overlaid. ' +
      'Strictly avoid: 3D cartoon render, CGI, flat illustration, glossy over-polished "AI look", oversaturation, plastic skin, text, logos, watermarks, fake charts, and any orange/warm/terracotta tones.',
    messages: [
      {
        role: 'user',
        content: `Article (${categoryName}): "${title}". Describe ONE believable news-style photographic scene that fits the topic. A person is OPTIONAL — a strong symbolic object/scene (document, money, keys, building, hands, interior) is often better. Emphasize realism and ordinary detail. Max 45 words. Output only the prompt.`,
      },
    ],
  });
  return resp.content.find((b) => b.type === 'text')?.text.trim();
}
