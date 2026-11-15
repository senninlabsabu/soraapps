import { config } from "./config.js";

// 画像の中身を保存する Turso（libSQL）。HTTP API を fetch で直接呼ぶので、追加のパッケージは使わない。
// 元のソラチャットと同じ方式。テーブルは soraapps 用の sa_blobs（ソラチャットの sc_blobs とは別）。
const ENDPOINT = `${config.tursoUrl.replace(/^libsql:\/\//, "https://").replace(/\/+$/, "")}/v2/pipeline`;

export type TursoArg =
  | { type: "text"; value: string }
  | { type: "integer"; value: string }
  | { type: "blob"; base64: string };

export type TursoValue =
  | { type: "null" }
  | { type: "text"; value: string }
  | { type: "integer"; value: string }
  | { type: "blob"; base64: string };

// 一時的な失敗（通信・タイムアウト・5xx・429）だけ、もう1回だけ試す
type TursoError = Error & { transient?: boolean };

async function tursoExecuteOnce(sql: string, args: TursoArg[]): Promise<TursoValue[][]> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.tursoAuthToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [
          { type: "execute", stmt: { sql, args } },
          { type: "close" }
        ]
      }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    const wrapped: TursoError = new Error(`Turso に接続できませんでした: ${error instanceof Error ? error.message : String(error)}`);
    wrapped.transient = true;
    throw wrapped;
  }
  const body = (await res.json().catch(() => null)) as {
    results?: { type: string; response?: { type: string; result?: { rows: TursoValue[][] } }; error?: { message?: string } }[];
    message?: string;
  } | null;
  if (!res.ok) {
    const wrapped: TursoError = new Error(`Turso の呼び出しに失敗しました（${res.status}）: ${body?.message ?? ""}`);
    wrapped.transient = res.status === 429 || res.status >= 500;
    throw wrapped;
  }
  const result = body?.results?.[0];
  if (!result || result.type !== "ok" || !result.response?.result) {
    throw new Error(`Turso の呼び出しに失敗しました: ${result?.error?.message ?? "不明なエラー"}`);
  }
  return result.response.result.rows;
}

export async function tursoExecute(sql: string, args: TursoArg[] = []): Promise<TursoValue[][]> {
  try {
    return await tursoExecuteOnce(sql, args);
  } catch (error) {
    if (!(error as TursoError).transient) throw error;
    console.warn("[turso] 一時的な失敗のため、もう一度試します:", error);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return tursoExecuteOnce(sql, args);
  }
}

// テーブルを作るのは、プロセスで最初に使うときに1回だけ（何度実行しても安全）
let schemaReady: Promise<void> | null = null;
export function ensureBlobTable(): Promise<void> {
  if (!schemaReady) {
    schemaReady = tursoExecute(
      `create table if not exists sa_blobs (
         id text primary key,
         content_type text not null,
         size integer not null,
         data blob not null,
         created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       )`
    ).then(() => undefined);
    // 失敗したら次の呼び出しでやり直す
    schemaReady.catch(() => {
      schemaReady = null;
    });
  }
  return schemaReady;
}
