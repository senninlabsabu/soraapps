import "dotenv/config";

// 環境変数を読む。前後の空白・改行や、貼り付けで入った引用符（"..." / '...'）は取り除く
const env = (name: string): string => {
  let value = (process.env[name] ?? "").trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    value = value.slice(1, -1).trim();
  }
  return value;
};

const need = (name: string): string => {
  const value = env(name);
  if (!value) throw new Error(`${name} を設定してください。`);
  return value;
};

// 仙人アカウントの場所（例: https://account.example.com）。末尾のスラッシュは取り除く
const senninBase = env("SENNIN_BASE_URL").replace(/\/+$/, "");
const senninUrl = (override: string, path: string) => (override ? override : senninBase ? `${senninBase}${path}` : "");
const apiUrl = (path: string, tokenUrl: string) => {
  try {
    return tokenUrl ? new URL(path, tokenUrl).toString() : "";
  } catch {
    return "";
  }
};

const tokenUrl = senninUrl(env("SENNIN_TOKEN_URL"), "/oauth/token");

// このアプリ自身のURL（仙人アカウントから戻ったあとの飛び先）
const appOrigin = (env("APP_ORIGIN") || "http://localhost:5173").replace(/\/+$/, "");

// ポイントの読み書きを含む許可。ログインのときに一緒に求める（ポイントの支払い・配布に必要）
// points:write は仙人アカウント側の管理者の承認が必要です
const senninScope = env("SENNIN_SCOPE") || "profile points:read points:write";

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  appOrigin,
  supabaseUrl: need("SUPABASE_URL"),
  supabaseServiceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  // 更新トークンの暗号化に使う（任意の長い文字列。変えると既存の連携は切れる）
  encryptionKey: need("APPS_ENCRYPTION_KEY"),
  adminPassword: env("ADMIN_PASSWORD"),
  // 画像の保存先（Turso）。元のソラチャットと同じ環境変数
  tursoUrl: need("TURSO_DATABASE_URL"),
  tursoAuthToken: need("TURSO_AUTH_TOKEN"),
  sennin: {
    clientId: env("SENNIN_CLIENT_ID"),
    clientSecret: env("SENNIN_CLIENT_SECRET"),
    redirectUri: env("SENNIN_REDIRECT_URI") || `${appOrigin}/api/auth/sennin/callback`,
    authorizationUrl: senninUrl(env("SENNIN_AUTHORIZATION_URL"), "/oauth/authorize"),
    tokenUrl,
    userinfoUrl: senninUrl(env("SENNIN_USERINFO_URL"), "/oauth/userinfo"),
    meUrl: senninUrl(env("SENNIN_ME_URL"), "/api/v1/me"),
    scope: senninScope,
    pointsUrl: env("SENNIN_POINTS_URL") || apiUrl("/api/v1/points", tokenUrl),
    pointsAdjustUrl: env("SENNIN_POINTS_ADJUST_URL") || apiUrl("/api/v1/points/adjust", tokenUrl)
  }
};

// 仙人アカウントの設定で足りないもの（環境変数の名前）。空なら連携に必要な設定はそろっている
export function missingSenninSettings(): string[] {
  const { clientId, clientSecret, authorizationUrl, tokenUrl: token, userinfoUrl } = config.sennin;
  const missing: string[] = [];
  if (!clientId) missing.push("SENNIN_CLIENT_ID");
  if (!clientSecret) missing.push("SENNIN_CLIENT_SECRET");
  if (!authorizationUrl) missing.push("SENNIN_AUTHORIZATION_URL（または SENNIN_BASE_URL）");
  if (!token) missing.push("SENNIN_TOKEN_URL（または SENNIN_BASE_URL）");
  if (!userinfoUrl) missing.push("SENNIN_USERINFO_URL（または SENNIN_BASE_URL）");
  return missing;
}
