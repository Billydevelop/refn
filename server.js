

// server.js
import express from "express";
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 강제 로딩
dotenv.config({ path: path.join(__dirname, ".env") });

console.log("DEBUG FIXED PATH:", path.join(__dirname, ".env"));

console.log("DEBUG AFTER dotenv SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("DEBUG AFTER dotenv SUPABASE_ANON_KEY =", process.env.SUPABASE_ANON_KEY?.slice(0, 20));

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// ==== ENV ====
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ==== 클라이언트 생성 ====
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

app.use(express.json());

// 정적 파일 서빙 (index.html, studio.html 등)
app.use(express.static("."));

/**
 * 공용: 에러 응답 헬퍼
 */
function sendError(res, status, message, extra = {}) {
  console.error("❌", message, extra);
  return res.status(status).json({
    ok: false,
    message,
    ...extra,
  });
}

/**
 * 공용: 요청에서 현재 유저 정보 가져오기
 *
 * - 일반적인 방식:
 *   프론트에서 Supabase access_token을
 *   Authorization: Bearer <token> 으로 보내준다.
 *
 *   const { data: { session } } = await sb.auth.getSession();
 *   fetch("/api/...", {
 *     headers: { Authorization: `Bearer ${session.access_token}` }
 *   })
 */
async function getUserFromRequest(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return null;

  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return data.user; // { id, email, ... }
}

// ===============================
// 기존 기능 1: 레퍼런스 검색 API
// POST /api/search-images
// ===============================
app.post("/api/search-images", async (req, res) => {
  const { prompt, keywords } = req.body;
  const query = [prompt, keywords].filter(Boolean).join(" ");
  const finalQuery = query || "abstract colorful gradient";

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
        finalQuery
      )}&per_page=12&orientation=squarish`,
      {
        headers: {
          Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error("Unsplash error:", await response.text());
      return res.status(500).json({ message: "unsplash error" });
    }

    const data = await response.json();

    const results = (data.results || []).map((item) => ({
      id: item.id,
      thumbUrl: item.urls.small,
      fullUrl: item.urls.full,
      tags: (item.tags || []).map((t) => t.title),
      source: `Unsplash · ${item.user.name}`,
    }));

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "image search error" });
  }
});

// ===============================
// 기존 기능 2: 이미지 생성 API
// POST /api/generate-images
// ===============================
app.post("/api/generate-images", async (req, res) => {
  const { prompt, keywords, referenceUrls = [], mode = "direct" } = req.body;

  const keywordText = keywords ? `\n\nKeywords: ${keywords}` : "";
  const refText =
    referenceUrls.length > 0
      ? `\n\nUse these image URLs only as style/pose reference (do NOT copy exactly):\n${referenceUrls
          .map((u, i) => `${i + 1}. ${u}`)
          .join("\n")}`
      : "";

  const finalPrompt =
    (prompt && prompt.trim().length > 0
      ? prompt.trim()
      : "A clean, colorful illustration, high quality, 4k") +
    keywordText +
    refText;

  console.log("📨 [generate-images] mode=", mode);
  console.log("prompt length:", finalPrompt.length);
  console.log("reference count:", referenceUrls.length);

  try {
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt: finalPrompt,
      n: 4,
      size: "1024x1024",
    });

    const images = (result.data || []).map((item) => {
      if (item.url) return item.url;
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      return null;
    });

    console.log("✅ image urls (or data urls):", images);

    res.json({ images });
  } catch (err) {
    console.error("❌ openai image error:");
    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", err.response.data);
    } else {
      console.error(err);
    }

    res.status(500).json({
      message: "image generate error",
      error:
        err?.response?.data ||
        err?.message ||
        "unknown internal error (check server log)",
    });
  }
});


// 크레딧/광고 설정 (수치만 여기서 조절하면 됨)
const CREDIT_SYSTEM = {
  adReward: {
    credits: 5,     // 광고 1회당 지급 크레딧
    maxPerDay: 3    // 하루 최대 광고 보상 횟수
  }
};



/**
 * 캐릭터 정보 조회 (상세 화면용)
 */
app.get('/api/characters/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

/**
 * 채팅 로그 조회 (최근 50개)
 */
app.get('/api/characters/:id/chats', async (req, res) => {
  const { id } = req.params;
  const { sessionId } = req.query;

  const query = supabase
    .from('character_chats')
    .select('*')
    .eq('character_id', id)
    .order('created_at', { ascending: true })
    .limit(50);

  if (sessionId) query.eq('session_id', sessionId);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * 캐릭터와 채팅 (1턴)
 * body: { sessionId, message }
 */
app.post('/api/characters/:id/chat', async (req, res) => {
  const { id } = req.params;
  const { sessionId, message } = req.body;

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!message || !sessionId) {
    return res.status(400).json({ error: 'sessionId, message 필요' });
  }

  const CREDIT_COST_PER_MESSAGE = 10;

  // 현재 wallet 조회 (없으면 0으로 간주)
  const { data: wallet, error: walletError } = await supabase
    .from('credit_wallets')
    .select('balance, lifetime_used')
    .eq('user_id', user.id)
    .maybeSingle();

  if (walletError) {
    console.error('character chat walletError', walletError);
    return res.status(500).json({ error: 'wallet_error' });
  }

  const currentBalance = wallet?.balance ?? 0;
  if (currentBalance < CREDIT_COST_PER_MESSAGE) {
    return res.status(402).json({
      error: 'insufficient_credits',
      required: CREDIT_COST_PER_MESSAGE,
      balance: currentBalance
    });
  }

  // 1) 캐릭터 정보
  const { data: character, error: charErr } = await supabase
    .from('characters')
    .select('id, name, prompt, intro')
    .eq('id', id)
    .single();

  if (charErr || !character) {
    return res.status(404).json({ error: 'character not found' });
  }

  // 2) 최근 대화 20개 (이 세션 기준)
  const { data: recentMessages, error: chatErr } = await supabase
    .from('character_chats')
    .select('role, content, created_at')
    .eq('character_id', id)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(20);

  if (chatErr) {
    return res.status(500).json({ error: chatErr.message });
  }

  // 3) 사용자 메시지 먼저 DB에 기록
  const { data: insertedUserMsg, error: insertUserErr } = await supabase
    .from('character_chats')
    .insert({
      character_id: id,
      user_id: user.id ?? null,
      session_id: sessionId,
      role: 'user',
      content: message
    })
    .select()
    .single();

  if (insertUserErr) {
    return res.status(500).json({ error: insertUserErr.message });
  }

  // 4) LLM 프롬프트 구성 (최적화 버전의 "간단 모드")
  const systemPrompt = `
당신은 "${character.name}"이라는 캐릭터입니다.
아래의 캐릭터 설정과 말투를 철저히 따라야 합니다.

[캐릭터 설정]
${character.prompt ?? ''}

[인트로 / 배경]
${character.intro ?? ''}

규칙:
- 캐릭터의 말투를 유지하세요.
- 너무 긴 답변 대신 2~4문단 정도로 답변하세요.
`;


  // 4-1) summary 불러오기
  let summaryText = '';
  const { data: summaryData } = await supabase
    .from('character_summaries')
    .select('summary')
    .eq('character_id', id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (summaryData && summaryData.length > 0) {
    summaryText = summaryData[0].summary;
  }

  // 4-2) 프롬프트 메시지 구성
  const messagesForModel = [
    { role: 'system', content: systemPrompt }
  ];
  if (summaryText) {
    messagesForModel.push({ role: 'system', content: `[장기 요약]\n${summaryText}` });
  }
  if (recentMessages && recentMessages.length > 0) {
    for (const m of recentMessages) {
      messagesForModel.push({
        role: m.role === 'character' ? 'assistant' :
              m.role === 'user' ? 'user' : 'system',
        content: m.content
      });
    }
  }
  messagesForModel.push({ role: 'user', content: message });

  // 4-3) 대화가 20개 이상이면 요약 생성 및 저장
  if (recentMessages && recentMessages.length >= 20) {
    try {
      const summaryPrompt = `다음은 캐릭터와 사용자의 대화 기록입니다. 캐릭터의 성격, 관계, 주요 사건, 감정 변화, 중요한 정보 등을 요약해 주세요.\n\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      const summaryRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '당신은 대화 요약 전문가입니다.' },
          { role: 'user', content: summaryPrompt }
        ],
        max_tokens: 256,
        temperature: 0.5,
      });
      const newSummary = summaryRes.choices[0]?.message?.content?.trim() ?? '';
      if (newSummary) {
        await supabase.from('character_summaries').insert({
          character_id: id,
          summary: newSummary,
          metadata: { session_id: sessionId, user_id: user.id }
        });
      }
    } catch (e) {
      console.error('요약 생성 오류:', e);
    }
  }

  // 5) OpenAI 호출
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messagesForModel,
      max_tokens: 512,
      temperature: 0.8,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'LLM 호출 실패' });
  }

  const replyText = completion.choices[0]?.message?.content?.trim() ?? '';
  const usage = completion.usage ?? {};
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (inputTokens + outputTokens);

  // 5-1) 크레딧 차감 (고정 10 크레딧/전송)
  const newBalance = currentBalance - CREDIT_COST_PER_MESSAGE;

  const { error: txError } = await supabase
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      subscription_id: null,
      tx_type: 'spend',
      category: 'character_chat',
      service_code: 'CHARACTER',
      amount: -CREDIT_COST_PER_MESSAGE,
      balance_after: newBalance,
      description: `character chat ${id}`,
      metadata: { characterId: id, sessionId }
    });

  if (txError) {
    console.error('character chat txError', txError);
    return res.status(500).json({ error: 'tx_error' });
  }

  const { error: walletUpdateErr } = await supabase
    .from('credit_wallets')
    .upsert({
      user_id: user.id,
      balance: newBalance,
      lifetime_used: (wallet?.lifetime_used ?? 0) + CREDIT_COST_PER_MESSAGE,
      updated_at: new Date().toISOString()
    });

  if (walletUpdateErr) {
    console.error('character chat wallet update error', walletUpdateErr);
    return res.status(500).json({ error: 'wallet_update_error' });
  }

  // 6) 캐릭터 답변도 DB에 기록
  const { data: insertedCharMsg, error: insertCharErr } = await supabase
    .from('character_chats')
    .insert({
      character_id: id,
      user_id: user.id ?? null,
      session_id: sessionId,
      role: 'character',
      content: replyText,
      model: 'gpt-4o-mini',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      credit_spent: CREDIT_COST_PER_MESSAGE,
      metadata: usage
    })
    .select()
    .single();

  if (insertCharErr) {
    return res.status(500).json({ error: insertCharErr.message });
  }

  // 7) 응답
  res.json({
    userMessage: insertedUserMsg,
    characterMessage: insertedCharMsg,
    credit: {
      spent: CREDIT_COST_PER_MESSAGE,
      balance: newBalance
    }
  });
});

// Server will be started at the end of the file (single consolidated startup block)







// 상품/플랜 설정 내려주는 API
app.get('/api/credit-config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('id, code, name, description, price_cents, features')
      .eq('is_active', true);

    if (error) {
      console.error('credit-config error', error);
      return res.status(500).json({ success: false, error: 'db_error' });
    }

    const paddleEnv =
      process.env.PADDLE_ENV ||
      (process.env.PADDLE_SANDBOX === 'true' ? 'sandbox' : null);
    const paddleClientToken =
      process.env.PADDLE_CLIENT_TOKEN ||
      process.env.PADDLE_CHECKOUT_TOKEN ||
      null;
    const paddleSellerId = process.env.PADDLE_SELLER_ID || null;

    return res.json({
      success: true,
      plans: data || [],
      adReward: CREDIT_SYSTEM.adReward,
      paddleVendorId: process.env.PADDLE_VENDOR_ID || null,
      paddleSellerId: paddleSellerId || undefined,
      paddleClientToken: paddleClientToken || null,
      paddleEnv: paddleEnv || undefined
    });
  } catch (e) {
    console.error('credit-config exception', e);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
});

// ad-session 생성: 보상형 광고를 시작하기 전 서버에서 세션을 생성합니다.
// - 클라이언트는 /api/ad-session을 호출해 sessionId를 받고,
//   이 sessionId를 광고 태그의 cust_params에 포함시켜 광고 요청/리포팅에 연결합니다.
// - 광고 완료 시 클라이언트는 /api/earn-credits로 sessionId를 제출하고 서버는 session을 검증한 뒤 지급합니다.
app.post('/api/ad-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ success: false, error: 'unauthorized' });

    const sessionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 minutes

    const { error } = await supabase.from('ad_sessions').insert([{
      id: sessionId,
      user_id: user.id,
      ad_network: 'GAM',
      created_at: now.toISOString(),
      expires_at: expiresAt,
      used: false
    }]);

    if (error) {
      console.error('ad-session insert error', error);
      return res.status(500).json({ success: false, error: 'db_error' });
    }

    return res.json({ success: true, sessionId, expiresAt });
  } catch (e) {
    console.error('ad-session exception', e);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
});

// 광고 보기로 크레딧 얻기
app.post('/api/earn-credits', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }

    const userId = user.id;

    // If the client provided a sessionId (created by /api/ad-session), validate it.
    const { sessionId, verification } = req.body || {};
    let adNetworkForTx = 'web_reward';

    // today 0시 check (moved down)
    // If sessionId exists, verify session record
    if (sessionId) {
      try {
        const { data: sessionRows, error: sessionError } = await supabase
          .from('ad_sessions')
          .select('*')
          .eq('id', sessionId)
          .maybeSingle();

        if (sessionError) {
          console.error('ad-session lookup error', sessionError);
          return res.status(500).json({ success: false, error: 'session_lookup_error' });
        }

        if (!sessionRows) {
          return res.status(400).json({ success: false, error: 'invalid_session', message: 'Ad session not found' });
        }

        if (sessionRows.user_id !== userId) {
          return res.status(403).json({ success: false, error: 'invalid_session_owner' });
        }

        if (sessionRows.used) {
          return res.status(400).json({ success: false, error: 'session_used' });
        }

        const now = new Date();
        if (sessionRows.expires_at && new Date(sessionRows.expires_at) < now) {
          return res.status(400).json({ success: false, error: 'session_expired' });
        }

        // set ad network for this session so transactions record source
        adNetworkForTx = sessionRows.ad_network || 'web_reward';

        // Optional: validate verification payload with ad network here
        // For GAM/IMA you might map session id to reporting data or call network APIs.
        // We'll treat the session as valid at this point (production should verify with network tokens if available).

        // mark session used atomically
        const { error: markError } = await supabase
          .from('ad_sessions')
          .update({ used: true, used_at: new Date().toISOString(), verification: verification || null })
          .eq('id', sessionId);

        if (markError) {
          console.error('ad-session mark used error', markError);
          return res.status(500).json({ success: false, error: 'session_update_error' });
        }
      } catch (e) {
        console.error('ad-session validation exception', e);
        return res.status(500).json({ success: false, error: 'session_exception' });
      }
    }

    // 오늘 0시 ~ 지금
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayRewards, error: rewardsError } = await supabase
      .from('credit_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('category', 'ad_reward')   // enum/타입 이름에 맞게 필요 시 수정
      .gte('occurred_at', todayStart.toISOString());

    if (rewardsError) {
      console.error('earn-credits rewardsError', rewardsError);
      return res.status(500).json({ success: false, error: 'db_error' });
    }

    const usedCount = todayRewards?.length || 0;
    if (usedCount >= CREDIT_SYSTEM.adReward.maxPerDay) {
      return res.json({
        success: false,
        error: 'limit_reached',
        message: '오늘은 더 이상 광고 보상을 받을 수 없습니다.'
      });
    }

    // 현재 wallet 조회
    const { data: wallet, error: walletError } = await supabase
      .from('credit_wallets')
      .select('balance, lifetime_used')
      .eq('user_id', userId)
      .maybeSingle();

    if (walletError) {
      console.error('earn-credits walletError', walletError);
      return res.status(500).json({ success: false, error: 'wallet_error' });
    }

    const currentBalance = wallet?.balance ?? 0;
    const add = CREDIT_SYSTEM.adReward.credits;
    const newBalance = currentBalance + add;

    // 트랜잭션 기록
    const { error: txError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        subscription_id: null,
        tx_type: 'earn',              // 실제 enum 값에 맞게 필요 시 수정
        category: 'ad_reward',        // 실제 타입에 맞게 필요 시 수정
        service_code: 'GLOBAL',
        amount: add,
        balance_after: newBalance,
        description: `${adNetworkForTx} rewarded ad`,
        metadata: { source: adNetworkForTx, verification: verification || null }
      });

    if (txError) {
      console.error('earn-credits txError', txError);
      return res.status(500).json({ success: false, error: 'tx_error' });
    }

    // wallet upsert
    const { error: upsertError } = await supabase
      .from('credit_wallets')
      .upsert({
        user_id: userId,
        balance: newBalance,
        lifetime_used: wallet?.lifetime_used ?? 0,
        updated_at: new Date().toISOString()
      });

    if (upsertError) {
      console.error('earn-credits upsertError', upsertError);
      return res.status(500).json({ success: false, error: 'wallet_update_error' });
    }

    return res.json({
      success: true,
      earned: add,
      balance: newBalance,
      usedToday: usedCount + 1,
      maxPerDay: CREDIT_SYSTEM.adReward.maxPerDay
    });
  } catch (e) {
    console.error('earn-credits exception', e);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
});


// 플랜 구매 시작 (구독권/크레딧 팩 공통)
// 구매(구독) 시작: Paddle 연동 지원
// - planCode 를 받아 plans 테이블에서 상품 정보를 찾습니다.
// - plans.features.paddle_product_id 또는 plans.features.paddle_link 존재 시 Paddle 결제 링크를 생성해서 반환합니다.
// - PADDLE_VENDOR_ID / PADDLE_VENDOR_AUTH_CODE 는 .env 에 설정해서 사용하세요 (절대 코드에 키를 하드코딩하지 마세요).
app.post('/api/buy-plan', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }

    const { planCode } = req.body;

    console.log('buy-plan request', user.id, planCode);

    // 1) plan 조회
    const { data: planData, error: planError } = await supabase
      .from('plans')
      .select('*')
      .eq('code', planCode)
      .maybeSingle();

    if (planError) {
      console.error('buy-plan plan lookup error', planError);
      return res.status(500).json({ success: false, error: 'plan_lookup_error' });
    }

    if (!planData) {
      return res.status(404).json({ success: false, error: 'plan_not_found' });
    }

    // 새로 추가: Paddle 연동 (환경변수에 PADDLE_VENDOR_* 설정되어 있어야 함)
    const PADDLE_VENDOR_ID = process.env.PADDLE_VENDOR_ID;
    const PADDLE_VENDOR_AUTH_CODE = process.env.PADDLE_VENDOR_AUTH_CODE;

    // 계획(features) 내부에서 paddle 관련 정보를 찾습니다.
    // 추천: plans.features JSON에 paddle_product_id 또는 paddle_link 를 저장하세요.
    const features = planData.features || {};
    const paddleProductId = features.paddle_product_id || null;
    const paddleLink = features.paddle_link || null;

    // If a paddle_link exists on the plan, return it directly
    if (paddleLink) {
      return res.json({ success: true, checkoutUrl: paddleLink });
    }

    // If Paddle is configured and product id present, call Paddle API to generate a pay link
    if (PADDLE_VENDOR_ID && PADDLE_VENDOR_AUTH_CODE && paddleProductId) {
      try {
        // Paddle API: generate_pay_link
        // Docs: https://developer.paddle.com/api-reference/0c52d5a975c4a-generate-pay-link
        const body = new URLSearchParams();
        body.append('vendor_id', PADDLE_VENDOR_ID);
        body.append('vendor_auth_code', PADDLE_VENDOR_AUTH_CODE);
        body.append('product_id', String(paddleProductId));
        // optional: passthrough can include planCode/user info for later verification
        body.append('passthrough', JSON.stringify({ planCode, userId: user.id }));

        const paddleRes = await fetch('https://vendors.paddle.com/api/2.0/product/generate_pay_link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });

        const paddleJson = await paddleRes.json();
        if (!paddleJson || !paddleJson.success) {
          console.error('paddle generate_pay_link failed', paddleJson);
          // fallback: return stub checkoutUrl
          return res.json({ success: false, error: 'paddle_link_error', details: paddleJson });
        }

        // paddleJson.response.url usually contains the hosted checkout URL
        const checkoutUrl = paddleJson.response && paddleJson.response.url;
        if (!checkoutUrl) {
          return res.json({ success: false, error: 'no_checkout_url' });
        }

        return res.json({ success: true, checkoutUrl });
      } catch (e) {
        console.error('paddle generate_pay_link exception', e);
        return res.status(500).json({ success: false, error: 'paddle_exception' });
      }
    }

    // Fallback: if a client token + price id env is provided, return that so the frontend can open the checkout
    const paddleClientToken =
      process.env.PADDLE_CLIENT_TOKEN ||
      process.env.PADDLE_CHECKOUT_TOKEN ||
      null;
    const paddleSellerId = process.env.PADDLE_SELLER_ID || null;
    const paddleEnv =
      process.env.PADDLE_ENV ||
      (process.env.PADDLE_SANDBOX === 'true' ? 'sandbox' : null);

    if (paddleClientToken) {
      const envKey = `PADDLE_PRICE_ID_${(planCode || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')}`;
      const fallbackPriceId =
        process.env[envKey] || process.env.PADDLE_PRICE_ID_DEFAULT || null;

      if (fallbackPriceId) {
        return res.json({
          success: true,
          paddle: {
            priceId: fallbackPriceId,
            clientToken: paddleClientToken,
            environment: paddleEnv || undefined,
            sellerId: paddleSellerId || undefined
          }
        });
      }
    }

    // TODO: implement other payment providers if needed

    // No paddle info / config — fallback
    return res.json({ success: true, checkoutUrl: '/coming-soon.html' });
  } catch (e) {
    console.error('buy-plan exception', e);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
});





// ===============================
// 서버 시작
// ===============================
// If certificate files (or env vars) are available, start HTTPS server for local dev
const CERT_KEY_PATH = process.env.CERT_KEY_PATH || './certs/localhost-key.pem';
const CERT_PEM_PATH = process.env.CERT_PEM_PATH || './certs/localhost.pem';

if (fs.existsSync(CERT_KEY_PATH) && fs.existsSync(CERT_PEM_PATH)) {
  try {
    const key = fs.readFileSync(CERT_KEY_PATH);
    const cert = fs.readFileSync(CERT_PEM_PATH);
    https.createServer({ key, cert }, app).listen(PORT, () => {
      console.log(`HTTPS server running on https://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start HTTPS server, falling back to HTTP', e);
    app.listen(PORT, () => {
      console.log(`HTTP server running on http://localhost:${PORT}`);
    });
  }
} else {
  app.listen(PORT, () => {
    console.log(`HTTP server running on http://localhost:${PORT}`);
  });
}


