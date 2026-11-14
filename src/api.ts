// サーバーの API を呼ぶ小さな窓口。失敗は理由（message・code）つきで投げる。
export class ApiFailure extends Error {
  status: number;
  code: string | null;
  remaining: number | null;
  constructor(status: number, message: string, code: string | null = null, remaining: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.remaining = remaining;
  }
}

type Init = Omit<RequestInit, "body"> & { json?: unknown; form?: FormData };

export async function api<T = any>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form; // 画像を含むので content-type は付けない（ブラウザが境界を付ける）
  }
  let res: Response;
  try {
    res = await fetch(path, { method: init.method, headers, body, credentials: "same-origin", signal: init.signal });
  } catch {
    throw new ApiFailure(0, "通信に失敗しました。時間をおいてお試しください。", "network");
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.ok === false) {
    throw new ApiFailure(
      res.status,
      String(data?.error ?? "エラーが発生しました。"),
      data?.code ?? null,
      typeof data?.remaining === "number" ? data.remaining : null
    );
  }
  return data as T;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "エラーが発生しました。");
