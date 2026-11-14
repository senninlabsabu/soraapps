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
  if (!url || !config.sennin.clientId) {
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

function clientAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json"
  };
  if (config.sennin.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.sennin.clientId}:${config.sennin.clientSecret}`).toString("base64")}`;
  }
  return headers;
}

async function postToken(body: Record<string, string>) {
  const url = requireApi(config.sennin.tokenUrl);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: clientAuthHeaders(),
      body: new URLSearchParams({ ...body, client_id: config.sennin.clientId }),
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
    throw new SenninError("unavailable", "仙人アカウントのトークンを取得できませんでした。");
  }
  return data as { access_token: string; refresh_token?: unknown };
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
      if (token.error === "invalid_grant" || token.error === "invalid_client") {
        await clearLink(userId);
        throw new SenninError("not_linked", NOT_LINKED_MESSAGE);
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
  const { status, data } = await senninRequest(userId, config.sennin.pointsAdjustUrl, "POST", {
    amount: args.amount,
    reason: args.reason,
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
