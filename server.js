

// server.js
import express from "express";
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import fetch, { FormData } from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 媛뺤젣 濡쒕뵫
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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_ANALYZE_MODEL = process.env.OPENAI_ANALYZE_MODEL || "gpt-4o-mini";
const STABILITY_API_KEY = process.env.STABILITY_API_KEY || null;
const FASHION_CREDIT_COST = parseInt(process.env.FASHION_CREDIT_COST, 10) || 20;
// Valid enum values: normal, event, bonus, refund
function safeCategory(value, fallback = "normal") {
  const allowed = ["normal", "event", "bonus", "refund"];
  if (!value) return fallback;
  const str = String(value).trim().toLowerCase();
  if (allowed.includes(str)) return str;
  return fallback;
}
const CREDIT_CATEGORY_CHAT = safeCategory(process.env.CREDIT_CATEGORY_CHAT);
const CREDIT_CATEGORY_FASHION = safeCategory(process.env.CREDIT_CATEGORY_FASHION);
// Valid tx_type enum: charge, usage, reset, adjustment
function safeTxType(value, fallback = "usage") {
  const allowed = ["charge", "usage", "reset", "adjustment"];
  if (!value) return fallback;
  const str = String(value).trim().toLowerCase();
  if (allowed.includes(str)) return str;
  return fallback;
}
const CREDIT_TX_TYPE_SPEND = safeTxType(process.env.CREDIT_TX_TYPE_SPEND);

// ==== ?대씪?댁뼵???앹꽦 ====
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// Admin client (bypasses RLS for internal credit operations)
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Increase body size limit to handle data URLs for analysis
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ?뺤쟻 ?뚯씪 ?쒕튃 (index.html, studio.html ??
app.use(express.static("."));

/**
 * 怨듭슜: ?먮윭 ?묐떟 ?ы띁
 */
function sendError(res, status, message, extra = {}) {
  console.error("ERROR", message, extra);
  return res.status(status).json({
    ok: false,
    message,
    ...extra,
  });
}

function clampSizeToOpenAI(size) {
  // gpt-image-1 supports 1024/512/256 square; pick the nearest lower size to reduce egress.
  const maxSide = Math.max(size?.width || 1024, size?.height || 1024);
  if (maxSide <= 256) return "256x256";
  if (maxSide <= 512) return "512x512";
  return "1024x1024";
}

function makeBBoxPrompt(bbox) {
  if (!bbox) return "";
  const { x = 0, y = 0, w = 1, h = 1 } = bbox;
  return `Place the garment inside the normalized bbox: x=${x.toFixed(
    3
  )}, y=${y.toFixed(3)}, w=${w.toFixed(3)}, h=${h.toFixed(
    3
  )} of the full canvas. Keep everything outside fully transparent.`;
}

function dataUrlToBuffer(dataUrl) {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid data URL");
  }
  return {
    buffer: Buffer.from(matches[2], "base64"),
    contentType: matches[1],
  };
}

/**
 * 怨듭슜: ?붿껌?먯꽌 ?꾩옱 ?좎? ?뺣낫 媛?몄삤湲?
 *
 * - ?쇰컲?곸씤 諛⑹떇:
 *   ?꾨줎?몄뿉??Supabase access_token??
 *   Authorization: Bearer <token> ?쇰줈 蹂대궡以??
 *
 *   const { data: { session } } = await sb.auth.getSession();
 *   fetch("/api/...", {
 *     headers: { Authorization: `Bearer ${session.access_token}` }
 *   })
 */
const authCache = new Map(); // token -> { user, expiresAt }
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getUserFromRequest(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return null;

  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) return null;

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const expiresAt = Date.now() + AUTH_CACHE_TTL_MS;
  authCache.set(token, { user: data.user, expiresAt });

  return data.user; // { id, email, ... }
}

// ===============================
// 湲곗〈 湲곕뒫 1: ?덊띁?곗뒪 寃??API
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
      source: `Unsplash 쨌 ${item.user.name}`,
    }));

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "image search error" });
  }
});

// ===============================
// 패션: 의상 교체 (OpenAI 이미지)
// POST /api/fashion/replace-outfit
// ===============================
app.post("/api/fashion/replace-outfit", async (req, res) => {
  try {
    const { baseImage, refImage, maskImage, prompt } = req.body || {};
    if (!baseImage) return sendError(res, 400, "baseImage is required");

    // Require login and credit check
    const user = await getUserFromRequest(req);
    if (!user) return sendError(res, 401, "unauthorized");

    const creditDb = supabaseAdmin || supabase;

    const { data: wallet, error: walletErr } = await creditDb
      .from("credit_wallets")
      .select("balance, lifetime_used")
      .eq("user_id", user.id)
      .maybeSingle();

    if (walletErr) {
      console.error("fashion wallet error", walletErr);
      return sendError(res, 500, "wallet_error", { error: walletErr.message });
    }

    const currentBalance = wallet?.balance ?? 0;
    if (currentBalance < FASHION_CREDIT_COST) {
      return sendError(res, 402, "insufficient_credits", {
        required: FASHION_CREDIT_COST,
        balance: currentBalance,
      });
    }

    async function chargeAndRespond(payload) {
      const newBalance = currentBalance - FASHION_CREDIT_COST;
      const { error: txError } = await creditDb.from("credit_transactions").insert({
        user_id: user.id,
        subscription_id: null,
        tx_type: CREDIT_TX_TYPE_SPEND,
        category: CREDIT_CATEGORY_FASHION,
        service_code: "FASHION",
        amount: -FASHION_CREDIT_COST,
        balance_after: newBalance,
        description: "fashion replace-outfit",
        metadata: { model: payload.model },
      });
      if (txError) {
        console.error("fashion tx error", txError);
        return sendError(res, 500, "tx_error", { error: txError.message });
      }

      const { error: walletUpdateErr } = await supabase.from("credit_wallets").upsert({
        user_id: user.id,
        balance: newBalance,
        lifetime_used: (wallet?.lifetime_used ?? 0) + FASHION_CREDIT_COST,
        updated_at: new Date().toISOString(),
      });
      if (walletUpdateErr) {
        console.error("fashion wallet update error", walletUpdateErr);
        return sendError(res, 500, "wallet_update_error", { error: walletUpdateErr.message });
      }

      return res.json({
        ...payload,
        credit: { spent: FASHION_CREDIT_COST, balance: newBalance },
      });
    }

    // If Stability key is present, prefer Stability img2img for stronger layout preservation
    if (STABILITY_API_KEY) {
      // Expect baseImage (and optional refImage) as data URLs; convert to buffer
      const { buffer: baseBuf, contentType } = dataUrlToBuffer(baseImage);
      const refHint = refImage ? "Reference outfit image is provided." : "No reference image.";
      const promptText = [
        prompt || "",
        "Keep the original person, pose, face, hair, hands, skin tone, shoes, lighting, and background exactly as in the base image.",
        "Only replace the clothing/accessories mentioned (e.g., tops, bottoms, watch). If an item is not mentioned, leave it unchanged.",
        refHint,
      ]
        .filter(Boolean)
        .join(" ");

      const form = new FormData();
      const mime = contentType || "image/png";
      const ext = mime.split("/")[1] || "png";
      const blob = new Blob([baseBuf], { type: mime });
      form.append("init_image", blob, `base.${ext}`);
      form.append("cfg_scale", "7");
      form.append("samples", "1");
      form.append("steps", "35");
      form.append("text_prompts[0][text]", promptText);
      form.append("text_prompts[0][weight]", "1");

      if (maskImage) {
        const { buffer: maskBuf, contentType: maskType } = dataUrlToBuffer(maskImage);
        const maskMime = maskType || "image/png";
        const maskExt = maskMime.split("/")[1] || "png";
        const maskBlob = new Blob([maskBuf], { type: maskMime });
        form.append("mask_image", maskBlob, `mask.${maskExt}`);

        const stabilityRes = await fetch(
          "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image/masking",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STABILITY_API_KEY}`,
            },
            body: form,
          }
        );

        if (!stabilityRes.ok) {
          const errText = await stabilityRes.text();
          console.error("stability error", errText);
          return sendError(res, stabilityRes.status || 500, "stability generation failed", {
            error: errText,
          });
        }

        const stabilityJson = await stabilityRes.json();
        const art = stabilityJson?.artifacts?.[0];
        if (!art?.base64) {
          return sendError(res, 500, "stability generation failed", { raw: stabilityJson });
        }

        return await chargeAndRespond({
          ok: true,
          model: "stability-sdxl-inpaint",
          dataUrl: `data:image/png;base64,${art.base64}`,
          imageUrl: null,
        });
      } else {
        form.append("image_strength", "0.35");
        const stabilityRes = await fetch(
          "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STABILITY_API_KEY}`,
            },
            body: form,
          }
        );

        if (!stabilityRes.ok) {
          const errText = await stabilityRes.text();
          console.error("stability error", errText);
          return sendError(res, stabilityRes.status || 500, "stability generation failed", {
            error: errText,
          });
        }

        const stabilityJson = await stabilityRes.json();
        const art = stabilityJson?.artifacts?.[0];
        if (!art?.base64) {
          return sendError(res, 500, "stability generation failed", { raw: stabilityJson });
        }

        return await chargeAndRespond({
          ok: true,
          model: "stability-sdxl-img2img",
          dataUrl: `data:image/png;base64,${art.base64}`,
          imageUrl: null,
        });
      }
    }

    // Fallback: OpenAI text-to-image (layout not guaranteed)
    const systemText =
      "Replace only the outfits/accessories requested. Keep the original person, pose, face, hair, hands, skin tone, shoes, lighting, and background unchanged.";
    const userText =
      prompt ||
      "Use the second picture as reference if present. Modify only the specified clothing parts; leave all other regions untouched.";

    const promptText = `${systemText}\n${userText}\nOnly change clothing/accessories that are explicitly mentioned; everything else must remain identical to the base image.`;

    const result = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt: promptText,
      n: 1,
      size: "1024x1024",
    });

    const item = result.data?.[0];
    const dataUrl = item?.b64_json
      ? `data:image/png;base64,${item.b64_json}`
      : null;
    const imageUrl = item?.url || null;

    if (!dataUrl && !imageUrl) {
      return sendError(res, 500, "image generation failed", { raw: item });
    }

    return await chargeAndRespond({
      ok: true,
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      dataUrl,
      imageUrl,
    });
  } catch (err) {
    console.error("fashion replace error:", err);
    return sendError(res, 500, "replace failed", { error: err?.message });
  }
});

// ===============================
// 湲곗〈 湲곕뒫 2: ?대?吏 ?앹꽦 API
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

  console.log("?벂 [generate-images] mode=", mode);
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

    console.log("??image urls (or data urls):", images);

    res.json({ images });
  } catch (err) {
    console.error("??openai image error:");
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


// ?щ젅??愿묎퀬 ?ㅼ젙 (?섏튂留??ш린??議곗젅?섎㈃ ??
const CREDIT_SYSTEM = {
  adReward: {
    credits: 5,     // 愿묎퀬 1?뚮떦 吏湲??щ젅??
    maxPerDay: 3    // ?섎（ 理쒕? 愿묎퀬 蹂댁긽 ?잛닔
  }
};



/**
 * 罹먮┃???뺣낫 議고쉶 (?곸꽭 ?붾㈃??
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
 * 梨꾪똿 濡쒓렇 議고쉶 (理쒓렐 50媛?
 */
app.get('/api/characters/:id/chats', async (req, res) => {
  const { id } = req.params;
  const { sessionId, since, limit } = req.query;

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

  const query = supabase
    .from('character_chats')
    .select('*')
    .eq('character_id', id)
    .order('created_at', { ascending: true })
    .limit(safeLimit);

  if (sessionId) query.eq('session_id', sessionId);
  if (since) query.gte('created_at', since);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * 罹먮┃?곗? 梨꾪똿 (1??
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
    return res.status(400).json({ error: 'sessionId, message ?꾩슂' });
  }

  const CREDIT_COST_PER_MESSAGE = 10;

  // ?꾩옱 wallet 議고쉶 (?놁쑝硫?0?쇰줈 媛꾩＜), 罹먮┃??理쒓렐 ????숈떆 ?붿껌?쇰줈 ?뺣났 ?뚯닔 媛먯냼
  const creditDb = supabaseAdmin || supabase;

  const [walletResult, characterResult, recentResult] = await Promise.all([
    creditDb
      .from('credit_wallets')
      .select('balance, lifetime_used')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('characters')
      .select('id, name, prompt, intro')
      .eq('id', id)
      .single(),
    supabase
      .from('character_chats')
      .select('role, content, created_at')
      .eq('character_id', id)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(20)
  ]);

  const walletError = walletResult.error;
  const wallet = walletResult.data;
  if (walletError) {
    console.error('character chat walletError', walletError);
    return res.status(500).json({ error: 'wallet_error' });
  }

  let currentBalance = wallet?.balance ?? 0;

  // wallet 행이 없거나 값이 비어 있을 때, 트랜잭션 집계로 복구
  if (!wallet) {
    try {
      const { data: agg, error: aggErr } = await creditDb
        .from('credit_transactions')
        .select('amount')
        .eq('user_id', user.id);
      if (aggErr) {
        console.error('character chat tx aggregate error', aggErr);
      } else {
        const sum = (agg || []).reduce((acc, row) => acc + (row.amount || 0), 0);
        currentBalance = sum;
        await creditDb.from('credit_wallets').upsert({
          user_id: user.id,
          balance: sum,
          lifetime_used: 0,
          updated_at: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error('character chat wallet fallback error', e);
    }
  }
  if (currentBalance < CREDIT_COST_PER_MESSAGE) {
    return res.status(402).json({
      error: 'insufficient_credits',
      required: CREDIT_COST_PER_MESSAGE,
      balance: currentBalance
    });
  }

  const charErr = characterResult.error;
  const character = characterResult.data;
  if (charErr || !character) {
    return res.status(404).json({ error: 'character not found' });
  }

  const chatErr = recentResult.error;
  const recentMessages = recentResult.data;
  if (chatErr) {
    return res.status(500).json({ error: chatErr.message });
  }

  // 3) LLM ?꾨＼?꾪듃 援ъ꽦 (理쒖쟻??踰꾩쟾??"媛꾨떒 紐⑤뱶")
  const systemPrompt = `
?뱀떊? "${character.name}"?대씪??罹먮┃?곗엯?덈떎.
?꾨옒??罹먮┃???ㅼ젙怨?留먰닾瑜?泥좎????곕씪???⑸땲??

[罹먮┃???ㅼ젙]
${character.prompt ?? ''}

[?명듃濡?/ 諛곌꼍]
${character.intro ?? ''}

洹쒖튃:
- 罹먮┃?곗쓽 留먰닾瑜??좎??섏꽭??
- ?덈Т 湲??듬? ???2~4臾몃떒 ?뺣룄濡??듬??섏꽭??
`;


  // 4-1) summary 遺덈윭?ㅺ린 (理쒓렐 1媛?+ 硫뷀??곗씠???ы븿??以묐났 insert 諛⑹?)
  let summaryText = '';
  const { data: summaryData } = await supabase
    .from('character_summaries')
    .select('id, summary, metadata, created_at')
    .eq('character_id', id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (summaryData && summaryData.length > 0) {
    summaryText = summaryData[0].summary;
  }

  // 4-2) ?꾨＼?꾪듃 硫붿떆吏 援ъ꽦
  const messagesForModel = [
    { role: 'system', content: systemPrompt }
  ];
  if (summaryText) {
    messagesForModel.push({ role: 'system', content: `[?κ린 ?붿빟]\n${summaryText}` });
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

  // 4-3) ??붽? 20媛??댁긽?대㈃ ?붿빟 ?앹꽦 諛????湲곗〈 ?붿빟? ?낅뜲?댄듃)
  if (recentMessages && recentMessages.length >= 20) {
    try {
      const summaryPrompt = `?ㅼ쓬? 罹먮┃?곗? ?ъ슜?먯쓽 ???湲곕줉?낅땲?? 罹먮┃?곗쓽 ?깃꺽, 愿怨? 二쇱슂 ?ш굔, 媛먯젙 蹂?? 以묒슂???뺣낫 ?깆쓣 ?붿빟??二쇱꽭??\n\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      const summaryRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '?뱀떊? ????붿빟 ?꾨Ц媛?낅땲??' },
          { role: 'user', content: summaryPrompt }
        ],
        max_tokens: 256,
        temperature: 0.5,
      });
      const newSummary = summaryRes.choices[0]?.message?.content?.trim() ?? '';
      if (newSummary) {
        const latestSummary = summaryData?.[0];
        const existingSessionId = latestSummary?.metadata?.session_id;
        if (latestSummary && existingSessionId === sessionId) {
          await supabase
            .from('character_summaries')
            .update({
              summary: newSummary,
              metadata: { session_id: sessionId, user_id: user.id },
              updated_at: new Date().toISOString()
            })
            .eq('id', latestSummary.id);
        } else {
          await supabase.from('character_summaries').insert({
            character_id: id,
            summary: newSummary,
            metadata: { session_id: sessionId, user_id: user.id }
          });
        }
      }
    } catch (e) {
      console.error('?붿빟 ?앹꽦 ?ㅻ쪟:', e);
    }
  }

  // 5) OpenAI ?몄텧
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
    return res.status(500).json({ error: 'LLM ?몄텧 ?ㅽ뙣' });
  }

  const replyText = completion.choices[0]?.message?.content?.trim() ?? '';
  const usage = completion.usage ?? {};
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (inputTokens + outputTokens);

  // 5-1) ?щ젅??李④컧 (怨좎젙 10 ?щ젅???꾩넚)
  const newBalance = currentBalance - CREDIT_COST_PER_MESSAGE;

  const { error: txError } = await creditDb
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      subscription_id: null,
      tx_type: CREDIT_TX_TYPE_SPEND,
      category: CREDIT_CATEGORY_CHAT,
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

  const { error: walletUpdateErr } = await creditDb
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

  // 6) ???濡쒓렇瑜???踰덉쓽 insert濡???ν븯???몄텧 ???덇컧
  const insertedAt = new Date();
  const userCreatedAt = insertedAt.toISOString();
  const characterCreatedAt = new Date(insertedAt.getTime() + 1).toISOString();

  const chatRows = [
    {
      character_id: id,
      user_id: user.id ?? null,
      session_id: sessionId,
      role: 'user',
      content: message,
      created_at: userCreatedAt
    },
    {
      character_id: id,
      user_id: user.id ?? null,
      session_id: sessionId,
      role: 'character',
      content: replyText,
      model: 'gpt-4o-mini',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      credit_spent: CREDIT_COST_PER_MESSAGE,
      metadata: usage,
      created_at: characterCreatedAt
    }
  ];

  const { data: insertedChats, error: insertChatErr } = await creditDb
    .from('character_chats')
    .insert(chatRows)
    .select('id, character_id, session_id, role, content, created_at, user_id, model, input_tokens, output_tokens, credit_spent, metadata');

  if (insertChatErr) {
    return res.status(500).json({ error: insertChatErr.message });
  }

  const insertedUserMsg = insertedChats.find((m) => m.role === 'user');
  const insertedCharMsg = insertedChats.find((m) => m.role === 'character');

  // 6-1) ?ㅻ옒?????蹂댁〈 ?뺤콉 (湲곕낯 90?? - 鍮꾨룞湲?
  const RETENTION_DAYS = 90;
  const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  supabase
    .from('character_chats')
    .delete()
    .lt('created_at', retentionCutoff)
    .eq('character_id', id)
    .then(({ error }) => {
      if (error) console.error('character chat retention cleanup error', error);
    });

  // 7) ?묐떟
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







// ?곹뭹/?뚮옖 ?ㅼ젙 ?대젮二쇰뒗 API
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

// ad-session ?앹꽦: 蹂댁긽??愿묎퀬瑜??쒖옉?섍린 ???쒕쾭?먯꽌 ?몄뀡???앹꽦?⑸땲??
// - ?대씪?댁뼵?몃뒗 /api/ad-session???몄텧??sessionId瑜?諛쏄퀬,
//   ??sessionId瑜?愿묎퀬 ?쒓렇??cust_params???ы븿?쒖폒 愿묎퀬 ?붿껌/由ы룷?낆뿉 ?곌껐?⑸땲??
// - 愿묎퀬 ?꾨즺 ???대씪?댁뼵?몃뒗 /api/earn-credits濡?sessionId瑜??쒖텧?섍퀬 ?쒕쾭??session??寃利앺븳 ??吏湲됲빀?덈떎.
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

// 愿묎퀬 蹂닿린濡??щ젅???산린
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

    // today 0??check (moved down)
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

    // ?ㅻ뒛 0??~ 吏湲?
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayRewards, error: rewardsError } = await supabase
      .from('credit_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('category', 'ad_reward')   // enum/????대쫫??留욊쾶 ?꾩슂 ???섏젙
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
        message: '?ㅻ뒛? ???댁긽 愿묎퀬 蹂댁긽??諛쏆쓣 ???놁뒿?덈떎.'
      });
    }

    // ?꾩옱 wallet 議고쉶
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

    // ?몃옖??뀡 湲곕줉
    const { error: txError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        subscription_id: null,
        tx_type: 'earn',              // ?ㅼ젣 enum 媛믪뿉 留욊쾶 ?꾩슂 ???섏젙
        category: 'ad_reward',        // ?ㅼ젣 ??낆뿉 留욊쾶 ?꾩슂 ???섏젙
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


// ?뚮옖 援щℓ ?쒖옉 (援щ룆沅??щ젅????怨듯넻)
// 援щℓ(援щ룆) ?쒖옉: Paddle ?곕룞 吏??
// - planCode 瑜?諛쏆븘 plans ?뚯씠釉붿뿉???곹뭹 ?뺣낫瑜?李얠뒿?덈떎.
// - plans.features.paddle_product_id ?먮뒗 plans.features.paddle_link 議댁옱 ??Paddle 寃곗젣 留곹겕瑜??앹꽦?댁꽌 諛섑솚?⑸땲??
// - PADDLE_VENDOR_ID / PADDLE_VENDOR_AUTH_CODE ??.env ???ㅼ젙?댁꽌 ?ъ슜?섏꽭??(?덈? 肄붾뱶???ㅻ? ?섎뱶肄붾뵫?섏? 留덉꽭??.
app.post('/api/buy-plan', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }

    const { planCode } = req.body;

    console.log('buy-plan request', user.id, planCode);

    // 1) plan 議고쉶
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

    // ?덈줈 異붽?: Paddle ?곕룞 (?섍꼍蹂?섏뿉 PADDLE_VENDOR_* ?ㅼ젙?섏뼱 ?덉뼱????
    const PADDLE_VENDOR_ID = process.env.PADDLE_VENDOR_ID;
    const PADDLE_VENDOR_AUTH_CODE = process.env.PADDLE_VENDOR_AUTH_CODE;

    // 怨꾪쉷(features) ?대??먯꽌 paddle 愿???뺣낫瑜?李얠뒿?덈떎.
    // 異붿쿇: plans.features JSON??paddle_product_id ?먮뒗 paddle_link 瑜???ν븯?몄슂.
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

    // No paddle info / config ??fallback
    return res.json({ success: true, checkoutUrl: '/coming-soon.html' });
  } catch (e) {
    console.error('buy-plan exception', e);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
});





// ===============================
// ?쒕쾭 ?쒖옉
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



