// 발행 파이프라인 장애 즉시 경보 — Slack + 운영자 이메일.
//   사용: node alert-failure.js <생성단계-로그파일>
//
// 기존 publish.yml 의 실패 알림은 마지막 백업 슬롯(08:15 KST)에서 Slack 한 줄만 보냈고,
// 그마저 놓쳐 2026-07-24~08-05 13일치 발행이 조용히 누락됐다(원인: Anthropic 크레딧 소진).
// 그래서 (1) 슬롯을 기다리지 않고 첫 실패 즉시, (2) Slack 뿐 아니라 이메일로도,
// (3) 스스로 복구되지 않는 결제/인증 장애는 별도 등급으로 구분해 알린다.
import 'dotenv/config';
import fs from 'node:fs/promises';
import { notify } from './lib/slack.js';

const CONSOLE_BILLING = 'https://console.anthropic.com/settings/billing';
const ACTIONS_URL = 'https://github.com/po-billy/crama/actions';

/* ── 장애 분류: 스스로 복구되는가? ── */
// blocking=true 인 장애는 다음 백업 슬롯이 재시도해도 100% 같은 이유로 죽는다.
// 이번 13일 누락이 정확히 이 경우였다 → 즉시·크게 알려야 하는 등급.
const KINDS = [
  {
    test: /credit balance is too low/i,
    kind: 'BILLING',
    blocking: true,
    title: 'Anthropic 크레딧 소진 — 자동 발행 전면 중단',
    action: `크레딧을 충전해야 복구됩니다: ${CONSOLE_BILLING}\n충전 전까지 매일 4개 슬롯이 전부 실패합니다.`,
  },
  {
    // 401/429 는 숫자만으로 매칭하면 빌드 로그(페이지 수 등)에 오탐하므로 문맥을 함께 요구한다
    test: /authentication_error|invalid x-api-key|status:?\s*401\b/i,
    kind: 'AUTH',
    blocking: true,
    title: 'Anthropic API 키 인증 실패 — 자동 발행 전면 중단',
    action: `키가 만료·회수됐을 수 있습니다. 새 키 발급 후 GitHub Secret ANTHROPIC_API_KEY 를 갱신하세요.\n${CONSOLE_BILLING}`,
  },
  {
    test: /rate_limit_error|status:?\s*429\b/i,
    kind: 'RATE',
    blocking: false,
    title: 'Anthropic API 레이트리밋 — 이번 슬롯 실패',
    action: '다음 백업 슬롯이 재시도합니다. 반복되면 한도를 확인하세요.',
  },
  {
    // 빌드가 깨지면 커밋을 막아 배포는 지키지만, 방치하면 매일 발행이 0이 된다.
    // 2026-08-07 사고는 반대로 '커밋은 되고 빌드만 깨진' 경우라 3일간 아무도 몰랐다.
    test: /Could not parse expression with acorn|@mdx-js\/rollup|\[vite\][\s\S]*Build failed|astro build.*(failed|ERROR)/i,
    kind: 'BUILD',
    blocking: true,
    title: '사이트 빌드 실패 — 글 커밋을 차단함(배포는 안전)',
    action:
      '생성된 MDX 가 컴파일되지 않아 커밋하지 않았습니다. 로그의 파일·행 번호를 보고 수정하세요.\n' +
      '자동 교정(fix-mdx.js)이 못 잡은 새로운 파손 패턴일 수 있습니다.',
  },
  {
    test: /overloaded_error|529/i,
    kind: 'OVERLOAD',
    blocking: false,
    title: 'Anthropic API 과부하 — 이번 슬롯 실패',
    action: '다음 백업 슬롯이 재시도합니다.',
  },
];

function classify(log) {
  for (const k of KINDS) if (k.test.test(log)) return k;
  return {
    kind: 'UNKNOWN',
    blocking: false,
    title: '자동 발행 실패 — 원인 미분류',
    action: `로그를 직접 확인하세요: ${ACTIONS_URL}`,
  };
}

/* ── 로그에서 사람이 읽을 한 줄만 뽑기 ── */
function extractError(log) {
  // Anthropic SDK 에러 본문의 message 필드가 가장 정확하다
  const m = log.match(/"message"\s*:\s*"([^"]{5,300})"/);
  if (m) return m[1];
  const crama = log.match(/^\[crama\] 실패: (.+)$/m);
  if (crama) return crama[1].slice(0, 300);
  const last = log.trim().split('\n').filter(Boolean).pop() || '(로그 없음)';
  return last.slice(0, 300);
}

// 어느 카테고리/클러스터에서 죽었는지 — 재시도 판단에 필요
function extractContext(log) {
  const m = log.match(/^\[crama\] (카테고리=.+)$/m);
  return m ? m[1] : null;
}

async function sendEmail({ subject, lines }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'RESEND_API_KEY 없음 — 이메일 스킵';
  const to =
    process.env.ALERT_EMAIL ||
    (process.env.VAPID_SUBJECT || '').replace(/^mailto:/, '') ||
    'gmlthd94@gmail.com';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <div style="border-left:4px solid #e11d48;padding:12px 16px;background:#fff1f2;border-radius:6px">
    <div style="font-size:18px;font-weight:700;color:#9f1239">${subject}</div>
  </div>
  <pre style="white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.7;color:#1f2937;background:#f9fafb;padding:16px;border-radius:6px;margin-top:16px">${lines
    .join('\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</pre>
  <p style="font-size:12px;color:#6b7280">crama.app 자동 발행 파이프라인 · 이 메일은 장애가 발생한 경우에만 발송됩니다.</p>
</div>`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Crama 알림 <brief@crama.app>', to, subject, html }),
      });
      if (res.ok) return `발송 완료 → ${to}`;
      if (res.status >= 400 && res.status < 500) return `실패 ${res.status}: ${await res.text()}`;
    } catch (e) {
      if (attempt === 2) return `에러: ${e.message}`;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return '실패(재시도 소진)';
}

async function main() {
  const logPath = process.argv[2];
  let log = '';
  try {
    log = await fs.readFile(logPath, 'utf8');
  } catch {
    log = '(로그 파일을 읽지 못함)';
  }

  const c = classify(log);
  const err = extractError(log);
  const ctx = extractContext(log);
  const today = new Date().toISOString().slice(0, 10);

  const lines = [
    `날짜: ${today} (UTC)`,
    ctx ? `단계: ${ctx}` : null,
    `분류: ${c.kind}${c.blocking ? ' — 자동 복구 불가' : ' — 다음 슬롯 재시도 가능'}`,
    '',
    `에러: ${err}`,
    '',
    c.action,
  ].filter((l) => l !== null);

  const emoji = c.blocking ? ':rotating_light:' : ':warning:';
  await notify(`${emoji} *${c.title}*\n\`\`\`${lines.join('\n')}\`\`\``);

  // 이메일은 (1) 스스로 복구되지 않는 장애이면서 (2) 허용된 슬롯일 때만.
  // 하루 4슬롯 전부 메일을 보내면 스팸이 되고, 스팸이 되면 또 안 보게 된다.
  // 워크플로가 첫 슬롯·마지막 슬롯에만 ALERT_EMAIL_ENABLED=1 을 준다 →
  // 첫 실패 즉시 1통 + 그날 전체 실패 확정 1통, 최대 2통.
  let mail;
  if (!c.blocking) mail = '스킵(자동 복구 가능 등급)';
  else if (process.env.ALERT_EMAIL_ENABLED !== '1') mail = '스킵(중간 백업 슬롯)';
  else mail = await sendEmail({ subject: `[crama] ${c.title}`, lines });

  console.log(`[alert] ${c.kind} / blocking=${c.blocking} / 이메일: ${mail}`);
}

main().catch((e) => {
  console.log(`[alert] 경보 자체 실패: ${e.message}`);
});
