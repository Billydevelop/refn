// Vercel Cron: Supabase 무료 플랜의 '비활성 일시정지' 방지용 핑.
// 무료 프로젝트는 일정 기간 요청이 없으면 정지되고, 정지되면 로그인·관심함·푸시구독이 한꺼번에 죽는다.
// 하루 1회, 가장 가벼운 읽기 1건만 보낸다. 데이터가 목적이 아니라 '접속이 있었다'는 사실이 목적.
//
// 스케줄은 site/vercel.json 의 crons 에 정의. 로컬/수동 확인은 /api/keepalive 로 GET.
export default async function handler(req, res) {
  // CRON_SECRET 이 설정돼 있으면 Vercel Cron 이 Authorization 헤더를 붙여 호출한다.
  // 설정돼 있을 때만 검사 — 미설정 환경에서 크론이 401 로 죽지 않게 한다.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const url = process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'PUBLIC_SUPABASE_URL/ANON_KEY 미설정' });
  }

  // wardrobe_items 는 RLS 정책이 `for select using (true)` 라 anon 키로 읽힌다.
  // select=id&limit=1 로 전송량을 최소화 — 그래도 PostgREST 를 거쳐 실제 DB 까지 닿는다.
  const started = Date.now();
  let ok = false;
  let detail = '';
  try {
    const r = await fetch(`${url}/rest/v1/wardrobe_items?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    ok = r.ok;
    detail = ok ? `${r.status}` : `${r.status} ${(await r.text()).slice(0, 200)}`;
  } catch (e) {
    detail = e.name === 'TimeoutError' ? '10초 타임아웃' : String(e.message || e);
  }
  const ms = Date.now() - started;

  // 실패를 조용히 넘기면 '언젠가 정지됐는데 아무도 모르는' 상태가 된다 → Slack 으로 알린다.
  if (!ok && process.env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:warning: *Supabase keepalive 실패* (${ms}ms)\n${detail}\n무료 플랜 일시정지 위험 — 프로젝트 상태를 확인하세요.`,
        }),
      });
    } catch {
      /* 알림 실패가 핑 결과를 가리지 않게 무시 */
    }
  }

  return res.status(ok ? 200 : 500).json({ ok, ms, detail });
}
