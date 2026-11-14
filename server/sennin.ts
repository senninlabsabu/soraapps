// 仙人アカウントとの連携（OAuth の交換・プロフィール）と、ポイントの残高・加算減算。
//
// ・更新トークンは暗号化して sa_sennin_tokens に保存する。更新するたびに新しいものに入れ替わるので、必ず保存し直す。
// ・同じユーザーの処理は直列に行う（同じ更新トークンを二重に使わないため）。
// ・ポイントの加算・減算は idempotency_key を付ける。同じキーなら二重には動かない。
import { config, missingSenninSettings } from "./config.js";
import { decryptText, encryptText } from "./crypto.js";
import { sb } from "./supabase.js";

// 失敗の種類。
// 「確実に実行されなかった」もの（DEFINITE_FAILURE）と、「実行されたか分からない」もの（unknown）を区別する。
// unknown のときは、同じ idempotency_key で押し直せば二重にはならない。
export class SenninError extends Error {
  code: string;
  points?: number;
  constructor(code: string, message: string, points?: number) {
    super(message);
    this.code = code;
    this.points = points;
  }
}

export const DEFINITE_FAILURE = new Set(["insufficient_points", "scope", "daily_limit", "invalid", "not_linked"]);

export const NOT_LINKED_MESSAGE = "仙人アカウントとの連携が切れています。ログインし直してください。";

// 文字数で切る（UTF-16 の途中で切ると、サロゲートペアの文字が壊れるため）
export function clipText(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

// 同じキーの処理を1つずつ行うための簡単なロック（このサーバー1台の中で有効）
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

const accessCache = new Map<string, { token: string; expires: number }>();

function requireApi(url: string): string {
  if (!url || !config.sennin.clientId || !config.sennin.clientSecret) {
    console.error(`[sennin] 仙人アカウントの設定が足りません: ${missingSenninSettings().join("、") || "ポイントのURL"}`);
    throw new SenninError("unavailable", "仙人アカウントは現在利用できません。");
  }
  return url;
}

export async function isLinked(userId: string): Promise<boolean> {
  const { data, error } = await sb.from("sa_sennin_tokens").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function saveRefreshToken(userId: string, refreshToken: string) {
  const { error } = await sb.from("sa_sennin_tokens").upsert(
    { user_id: userId, refresh_token_enc: encryptText(refreshToken), updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  if (error) throw error;
  accessCache.delete(userId);
}

export async function clearLink(userId: string) {
  accessCache.delete(userId);
  const { error } = await sb.from("sa_sennin_tokens").delete().eq("user_id", userId);
  if (error) throw error;
}

// クライアント認証は client_secret_basic（Basic ヘッダ）だけを使う。
// 本文に client_id / client_secret を入れると、認証方式が二重になるため入れない。
function clientAuthHeaders(): Record<string, string> {
  return {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${config.sennin.clientId}:${config.sennin.clientSecret}`).toString("base64")}`
  };
}

async function postToken(body: Record<string, string>) {
  const url = requireApi(config.sennin.tokenUrl);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: clientAuthHeaders(),
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10_000)
    });
    const data: any = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    throw new SenninError("unavailable", "仙人アカウントに接続できませんでした。時間をおいてお試しください。");
  }
}

// 認可コードをトークンに交換する（PKCE の verifier を付ける）
export async function exchangeCode(code: string, verifier: string) {
  const { status, data } = await postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.sennin.redirectUri,
    code_verifier: verifier
  });
  if (status !== 200 || typeof data.access_token !== "string") {
    if (data?.error === "invalid_grant") {
      throw new SenninError("unavailable", "認証の有効期限が切れました。もう一度ログインしてください。");
    }
    if (data?.error === "invalid_client") {
      console.error("[sennin] client_id / client_secret が仙人アカウントに認められません（アプリの設定を確認）");
      throw new SenninError("unavailable", "仙人アカウントの設定に問題があります。管理者に確認してください。");
    }
    throw new SenninError("unavailable", "仙人アカウントのトークンを取得できませんでした。");
  }
  return data as { access_token: string; refresh_token?: unknown; scope?: unknown };
}

// トークンを失効させる（RFC 7009）。失敗しても画面の流れは止めない
export async function revokeSenninToken(token: string): Promise<void> {
  const url = config.sennin.revokeUrl;
  if (!url || !config.sennin.clientId || !config.sennin.clientSecret) return;
  await fetch(url, {
    method: "POST",
    headers: clientAuthHeaders(),
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined);
}

// アクセストークンでプロフィールを読む
export async function fetchProfile(accessToken: string): Promise<{ id: string; name: string }> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
  const getJson = (url: string) =>
    fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  const pick = (payload: any) => payload?.user ?? payload?.data ?? payload;
  let data = pick(await getJson(config.sennin.userinfoUrl));
  if (!data?.id && !data?.sub && config.sennin.meUrl) data = pick(await getJson(config.sennin.meUrl));
  const id = data?.id ?? data?.sub ?? data?.user_id;
  if (!id) throw new SenninError("unavailable", "仙人アカウントの情報を取得できませんでした。");
  return { id: String(id), name: String(data.name ?? data.display_name ?? data.username ?? "仙人ユーザー").slice(0, 40) };
}

// 更新トークンでアクセストークンを取り直し、新しい更新トークンを保存する
async function refreshAccessToken(userId: string): Promise<string> {
  return withLock(`sennin-token:${userId}`, async () => {
    const cached = accessCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.token;

    const { data, error } = await sb.from("sa_sennin_tokens").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new SenninError("not_linked", NOT_LINKED_MESSAGE);

    const { status, data: token } = await postToken({
      grant_type: "refresh_token",
      refresh_token: decryptText(data.refresh_token_enc as string)
    });
    if (status === 429 || status >= 500) {
      throw new SenninError("unavailable", "仙人アカウントが混み合っています。時間をおいてお試しください。");
    }
    if (status !== 200 || typeof token.access_token !== "string") {
      // invalid_grant は、このユーザーの許可が取り消された・無効になったことを表す（連携を解除する）
      if (token.error === "invalid_grant") {
        await clearLink(userId);
        throw new SenninError("not_linked", NOT_LINKED_MESSAGE);
      }
      // invalid_client はアプリ側の設定の問題（ユーザーの連携とは無関係）なので、連携は残す
      if (token.error === "invalid_client") {
        console.error("[sennin] client 認証に失敗（client_id / client_secret・アプリの無効化を確認）");
        throw new SenninError("unavailable", "仙人アカウントの設定に問題があります。管理者に確認してください。");
      }
      throw new SenninError("unavailable", "仙人アカウントの確認に失敗しました。時間をおいてお試しください。");
    }
    if (typeof token.refresh_token === "string") await saveRefreshToken(userId, token.refresh_token);
    const ttl = Number(token.expires_in) > 0 ? Number(token.expires_in) : 3600;
    accessCache.set(userId, { token: token.access_token, expires: Date.now() + (ttl - 60) * 1000 });
    return token.access_token as string;
  });
}

async function accessToken(userId: string): Promise<string> {
  const cached = accessCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.token;
  return refreshAccessToken(userId);
}

// 仙人アカウントのAPIを、そのユーザーの権限で呼ぶ。401 なら取り直して1回だけ再試行する
async function senninRequest(userId: string, url: string, method: "GET" | "POST", body?: unknown) {
  requireApi(url);
  const send = async (token: string) => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000)
      });
      const data: any = await response.json().catch(() => ({}));
      return { status: response.status, data };
    } catch {
      throw new SenninError("unknown", "通信に失敗しました。結果を確かめるため、もう一度お試しください。");
    }
  };

  let result = await send(await accessToken(userId));
  if (result.status === 401) {
    accessCache.delete(userId);
    result = await send(await refreshAccessToken(userId));
    if (result.status === 401) throw new SenninError("not_linked", NOT_LINKED_MESSAGE);
  }
  return result;
}

export async function fetchBalance(userId: string): Promise<number> {
  const { status, data } = await senninRequest(userId, config.sennin.pointsUrl, "GET");
  if (status === 200 && data?.ok && typeof data.points === "number") return data.points;
  if (status === 403) throw new SenninError("scope", "ポイントを見る許可がありません。ログインし直してください。");
  throw new SenninError("unavailable", "ポイントを取得できませんでした。時間をおいてお試しください。");
}

export type AdjustResult = { points: number; ledgerId: string | null; replayed: boolean };

// ポイントを加算（正）・減算（負）する。idempotencyKey が同じなら、二重には動かない
export async function adjustPoints(
  userId: string,
  args: { amount: number; reason: string; idempotencyKey: string }
): Promise<AdjustResult> {
  // 仙人アカウントに送る前に、仕様の条件（整数・0以外・理由1〜100文字・キーの形式）を確かめる
  if (!Number.isSafeInteger(args.amount) || args.amount === 0) {
    throw new SenninError("invalid", "ポイントは 0 以外の整数で指定してください。");
  }
  const reason = clipText(args.reason.trim(), 100);
  if (!reason) throw new SenninError("invalid", "ポイントの理由を入れてください。");
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(args.idempotencyKey)) {
    throw new SenninError("invalid", "処理IDの形式が正しくありません。");
  }
  const { status, data } = await senninRequest(userId, config.sennin.pointsAdjustUrl, "POST", {
    amount: args.amount,
    reason,
    idempotency_key: args.idempotencyKey
  });
  if (status === 200 && data?.ok) {
    return {
      points: Number(data.points),
      ledgerId: typeof data.ledger_id === "string" ? data.ledger_id : null,
      replayed: Boolean(data.replayed)
    };
  }
  if (status === 409 && data?.error === "insufficient_points") {
    throw new SenninError("insufficient_points", "ポイントが足りません。", Number(data.points ?? 0));
  }
  if (status === 403) {
    throw new SenninError("scope", "仙人アカウント側で、ポイントを使う許可が有効になっていません。管理者に確認してください。");
  }
  if (status === 429 && data?.error === "daily_limit_exceeded") {
    throw new SenninError("daily_limit", "今日のポイント利用の上限に達しました。明日もう一度お試しください。");
  }
  if (status === 429 || status >= 500) {
    throw new SenninError("unknown", "仙人アカウントが混み合っています。結果を確かめるため、もう一度お試しください。");
  }
  if (status === 400 || status === 409) {
    throw new SenninError("invalid", String(data?.error_description ?? "ポイントの処理ができませんでした。"));
  }
  throw new SenninError("unknown", "ポイントの処理結果を確かめられませんでした。もう一度お試しください。");
}
