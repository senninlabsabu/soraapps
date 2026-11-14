// 仙人アカウントでのログイン（OAuth 2.0 + PKCE）と、ログイン中の人の情報。
// ログインは仙人アカウントだけ。ログインのときに、ポイントの許可も一緒に求める（支払い・配布に必要）。
import crypto from "node:crypto";
import { Router } from "express";
import { config, missingSenninSettings } from "./config.js";
import { cookieBase, endSession, sessionUserId, SESSION_COOKIE, startSession } from "./session.js";
import { randomToken } from "./crypto.js";
import { sb } from "./supabase.js";
import { exchangeCode, fetchProfile, isLinked, saveRefreshToken, SenninError } from "./sennin.js";
import { retryCreatorPayouts } from "./payments.js";

export const auth = Router();

const OAUTH_COOKIE = "sa_oauth";

auth.get("/auth/options", (_req, res) => {
  const { clientId, authorizationUrl, tokenUrl, redirectUri } = config.sennin;
  res.set("Cache-Control", "no-store");
  res.json({ sennin: Boolean(clientId && authorizationUrl && tokenUrl && redirectUri) });
});

auth.get("/auth/sennin/login", (_req, res) => {
  const { clientId, authorizationUrl, redirectUri, scope } = config.sennin;
  if (!clientId || !authorizationUrl) {
    console.error(`[sennin] 仙人アカウントの設定が足りません: ${missingSenninSettings().join("、")}`);
    res.redirect(`${config.appOrigin}/login?auth_error=${encodeURIComponent("仙人アカウントは現在利用できません。")}`);
    return;
  }
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  res.cookie(OAUTH_COOKIE, `${state}.${verifier}`, { ...cookieBase, maxAge: 10 * 60 * 1000 });
  const url = new URL(authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(url.toString());
});

auth.get("/auth/sennin/callback", async (req, res) => {
  const fail = (message: string) => {
    res.clearCookie(OAUTH_COOKIE, cookieBase);
    res.redirect(`${config.appOrigin}/login?auth_error=${encodeURIComponent(message.slice(0, 180))}`);
  };
  if (typeof req.query.error === "string") {
    fail("仙人アカウントでの認証がキャンセルされました。ポイントの利用を許可してください。");
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const returned = typeof req.query.state === "string" ? req.query.state : "";
  const [state, verifier] = String(req.cookies?.[OAUTH_COOKIE] ?? "").split(".");
  if (!code || !state || !verifier || state !== returned) {
    fail("認証情報を確認できませんでした。もう一度お試しください。");
    return;
  }
  try {
    const tokens = await exchangeCode(code, verifier);
    if (typeof tokens.refresh_token !== "string") {
      fail("ポイントの利用の許可がありません。仙人アカウントの画面で許可してから、もう一度お試しください。");
      return;
    }
    const profile = await fetchProfile(tokens.access_token);
    const userId = await upsertUser(profile.id, profile.name);
    await saveRefreshToken(userId, tokens.refresh_token);
    res.clearCookie(OAUTH_COOKIE, cookieBase);
    await startSession(res, userId);
    void retryCreatorPayouts(userId).catch((error) => console.error("[apps] 支払いの再送に失敗:", error));
    res.redirect(`${config.appOrigin}/`);
  } catch (error) {
    if (error instanceof SenninError) return fail(error.message);
    console.error(error);
    fail("仙人アカウントへの接続に失敗しました。");
  }
});

async function upsertUser(senninId: string, name: string): Promise<string> {
  const found = await sb.from("sa_users").select("id, display_name").eq("sennin_id", senninId).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) {
    if (found.data.display_name !== name) {
      await sb.from("sa_users").update({ display_name: name }).eq("id", found.data.id as string);
    }
    return found.data.id as string;
  }
  const inserted = await sb.from("sa_users").insert({ sennin_id: senninId, display_name: name }).select("id").single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id as string;
}

auth.get("/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const userId = await sessionUserId(req.cookies?.[SESSION_COOKIE]);
  if (!userId) {
    res.json({ user: null });
    return;
  }
  const { data } = await sb.from("sa_users").select("id, display_name").eq("id", userId).maybeSingle();
  if (!data) {
    res.json({ user: null });
    return;
  }
  res.json({ user: { id: data.id, displayName: data.display_name, linked: await isLinked(userId) } });
});

auth.post("/auth/logout", async (req, res) => {
  await endSession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, cookieBase);
  res.json({ ok: true });
});
