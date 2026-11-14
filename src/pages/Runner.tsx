// 拡張機能の実行画面（全画面）。
//
// 拡張機能は sandbox の iframe（allow-scripts のみ・same-origin なし）で動く。枠の中から
// サーバーへは直接届かないので、window.sorachat の依頼（postMessage）をこの画面が受けて、
// 利用者の許可を確かめ、サーバーへ取り次ぐ。配布・支払いの上限や許可は、サーバーが最後に確かめる。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiFailure, errorText } from "../api";
import { Icon } from "../components/Icon";
import { priceLabel } from "../components/Stars";

const CHANNEL = "soraapps-ext";

type Access = {
  ok: true;
  consented: boolean;
  needsConsent: boolean;
  grant: { remaining: number } | null;
  sorachat?: { id: string; displayName: string };
  sennin?: { linked: boolean };
};

type Reply = { ok: boolean; data?: unknown; code?: string; error?: string };

// 支払いの確認（利用者が「払う」を押すまで、枠へは答えない）。
// 支払いの種類（ポイントの支払い・アプリ内課金）ごとに、サーバーへ送る処理（send）を持つ
type PayRequest = {
  amount: number;
  title: string;
  resolve: (reply: Reply) => void;
  busy: boolean;
  done: string;
  send: () => Promise<any>;
};

const failure = (e: unknown): Reply => {
  if (e instanceof ApiFailure) {
    return { ok: false, code: e.code ?? "error", error: e.message, data: e.remaining !== null ? { remaining: e.remaining } : undefined };
  }
  return { ok: false, code: "error", error: errorText(e) };
};

export function Runner({ id }: { id: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState("拡張機能");
  const [access, setAccess] = useState<Access | null>(null);
  const [frameOpen, setFrameOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pay, setPay] = useState<PayRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const handleRef = useRef<(type: string, data: Record<string, unknown>) => Promise<Reply>>(async () => ({ ok: false }));

  const loadAccess = useCallback(async () => {
    const a = await api<Access>(`/api/run/${id}/access`);
    setAccess(a);
    return a;
  }, [id]);

  useEffect(() => {
    api<{ app: { name: string } }>(`/api/store/apps/${id}`)
      .then((d) => setName(d.app.name))
      .catch(() => undefined);
    loadAccess()
      .then((a) => setFrameOpen(!a.needsConsent || a.consented))
      .catch((e) => setLoadError(errorText(e)));
  }, [id, loadAccess]);

  // 最新の access を、非同期の処理からも読めるようにする（枠からの依頼は古い値を見ないように）
  const accessRef = useRef<Access | null>(null);
  useEffect(() => {
    accessRef.current = access;
  }, [access]);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 3000);
  };

  // 利用者の許可（ユーザー情報を、この拡張機能に渡してよいか）
  const allowAccount = async () => {
    setConsentBusy(true);
    try {
      await api(`/api/run/${id}/consent`, { method: "POST" });
      await loadAccess();
      setFrameOpen(true);
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setConsentBusy(false);
    }
  };

  const revokeAccount = async () => {
    await api(`/api/run/${id}/consent`, { method: "DELETE" }).catch(() => undefined);
    navigate("/library");
  };

  // 枠からの依頼を、種類ごとに処理する
  const handle = useCallback(
    async (type: string, data: Record<string, unknown>): Promise<Reply> => {
      if (type.startsWith("storage-")) {
        const key = typeof data.key === "string" ? encodeURIComponent(data.key) : "";
        try {
          if (type === "storage-keys") return { ok: true, data: await api(`/api/run/${id}/storage`) };
          if (!key) return { ok: false, code: "invalid", error: "キーを指定してください。" };
          if (type === "storage-get") return { ok: true, data: await api(`/api/run/${id}/storage/${key}`) };
          if (type === "storage-set") return { ok: true, data: await api(`/api/run/${id}/storage/${key}`, { method: "PUT", json: { value: data.value } }) };
          if (type === "storage-remove") return { ok: true, data: await api(`/api/run/${id}/storage/${key}`, { method: "DELETE" }) };
        } catch (e) {
          return failure(e);
        }
        return { ok: false, code: "unknown_request", error: "対応していない依頼です。" };
      }

      if (type === "account") {
        const latest = accessRef.current ?? (await loadAccess());
        if (!latest.consented) {
          return { ok: false, code: "not_consented", error: "ユーザー情報の共有を許可していません。" };
        }
        return { ok: true, data: { consented: true, sorachat: latest.sorachat, sennin: latest.sennin, grant: latest.grant } };
      }

      if (type === "consent") {
        return accessRef.current?.consented
          ? { ok: true, data: { consented: true } }
          : { ok: false, code: "not_consented", error: "ユーザー情報の共有を許可していません。" };
      }

      if (type === "award") {
        try {
          const body = await api<{ awarded: number; points: number | null; replayed: boolean }>(`/api/run/${id}/award`, {
            method: "POST",
            json: { amount: data.amount, reason: data.reason, requestId: data.requestId }
          });
          if (!body.replayed) showToast(`${body.awarded.toLocaleString("ja-JP")} pt を受け取りました`);
          return { ok: true, data: body };
        } catch (e) {
          return failure(e);
        }
      }

      if (type === "charge") {
        if (!accessRef.current?.consented) {
          return { ok: false, code: "not_consented", error: "ユーザー情報の共有を許可していません。" };
        }
        const amount = data.amount;
        const title = typeof data.title === "string" ? data.title.trim() : "";
        const requestId = typeof data.requestId === "string" ? data.requestId : "";
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
          return { ok: false, code: "invalid", error: "支払うポイントは 1 以上の整数で指定してください。" };
        }
        if (!title) return { ok: false, code: "invalid", error: "品名を指定してください。" };
        // 確認画面を出し、利用者が決めるまで待つ
        return new Promise<Reply>((resolve) =>
          setPay({
            amount,
            title,
            resolve,
            busy: false,
            done: `${amount.toLocaleString("ja-JP")} pt を支払いました`,
            send: () => api(`/api/run/${id}/charge`, { method: "POST", json: { amount, title, requestId } })
          })
        );
      }

      // アプリ内課金：商品の一覧
      if (type === "iap-products") {
        try {
          const d = await api<{ products: unknown[] }>(`/api/run/${id}/iap`);
          return { ok: true, data: { products: d.products } };
        } catch (e) {
          return failure(e);
        }
      }

      // アプリ内課金：商品を買う（価格と名前を確認画面に出してから支払う）
      if (type === "iap-purchase") {
        const sku = typeof data.sku === "string" ? data.sku : "";
        let products: Array<{ sku: string; title: string; price: number; owned: boolean }>;
        try {
          products = (await api<{ products: typeof products }>(`/api/run/${id}/iap`)).products;
        } catch (e) {
          return failure(e);
        }
        const product = products.find((p) => p.sku === sku);
        if (!product) return { ok: false, code: "invalid", error: "この商品は見つかりません。" };
        if (product.owned) return { ok: true, data: { sku, replayed: true } };
        return new Promise<Reply>((resolve) =>
          setPay({
            amount: product.price,
            title: product.title,
            resolve,
            busy: false,
            done: `「${product.title}」を購入しました`,
            send: async () => ({ sku, ...(await api(`/api/run/${id}/iap/purchase`, { method: "POST", json: { sku } })) })
          })
        );
      }

      return { ok: false, code: "unknown_request", error: "対応していない依頼です。" };
    },
    [id, loadAccess]
  );

  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  // 枠からの postMessage を受ける。送り元が自分の枠であることを確かめてから処理する
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return;
      const msg = event.data as { channel?: unknown; id?: unknown; type?: unknown; data?: Record<string, unknown> } | null;
      if (!msg || msg.channel !== CHANNEL || typeof msg.id !== "string" || typeof msg.type !== "string") return;
      const requestId = msg.id;
      void handleRef.current(msg.type, msg.data ?? {}).then((reply) => {
        frame.contentWindow?.postMessage({ channel: CHANNEL, id: requestId, ...reply }, "*");
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 支払いの確認：払う → サーバーで払う。やめる → 枠へ「キャンセル」を返す
  const confirmPay = async () => {
    const current = pay;
    if (!current || current.busy) return;
    setPay({ ...current, busy: true });
    try {
      const body = await current.send();
      current.resolve({ ok: true, data: body });
      showToast(current.done);
    } catch (e) {
      current.resolve(failure(e));
    }
    setPay(null);
  };

  const cancelPay = () => {
    if (!pay || pay.busy) return;
    pay.resolve({ ok: false, code: "cancelled", error: "支払いをキャンセルしました。" });
    setPay(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pay) cancelPay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const needsConsentSheet = !!access && access.needsConsent && !access.consented && !frameOpen;

  return (
    <div className="runner" role="dialog" aria-label={name}>
      <header className="runner-head">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="戻る">
          <Icon name="back" size={22} />
        </button>
        <h1>{name}</h1>
        <div className="runner-right">
          {access?.consented && (
            <button type="button" className="btn ghost small" onClick={revokeAccount}>許可を取り消す</button>
          )}
        </div>
      </header>

      {loadError && <p className="notice error runner-notice">{loadError}</p>}
      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="runner-stage">
        {frameOpen ? (
          <iframe
            ref={frameRef}
            className="ext-frame"
            title={name}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            src={`/api/run/${id}/frame`}
          />
        ) : (
          !loadError && <div className="ext-wait muted">{needsConsentSheet ? "アカウント情報の許可を確認してください" : "読み込み中…"}</div>
        )}
      </div>

      {needsConsentSheet && (
        <div className="sheet-backdrop">
          <div className="sheet" role="alertdialog" aria-label="アカウント情報の許可">
            <h2>アカウント情報の共有</h2>
            <p>
              「{name}」に、あなたのユーザー名・表示名・仙人アカウントとの連携の有無を渡してよいか確認します。
              ポイントを配る拡張機能では、配布のためにこの許可が必要です。
            </p>
            <p className="small muted">いつでも「許可を取り消す」から取り消せます。</p>
            <div className="sheet-actions">
              <button type="button" className="btn ghost" onClick={() => navigate(-1)}>やめる</button>
              <button type="button" className="btn primary" onClick={allowAccount} disabled={consentBusy}>
                {consentBusy ? "処理中…" : "許可して開く"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pay && (
        <div className="sheet-backdrop">
          <div className="sheet" role="alertdialog" aria-label="支払いの確認">
            <h2>{pay.title}</h2>
            <p className="pay-amount">{priceLabel(pay.amount)}</p>
            <p className="small muted">「{name}」からの支払いです。払うを押したときだけ、ポイントが減ります。</p>
            <div className="sheet-actions">
              <button type="button" className="btn ghost" onClick={cancelPay} disabled={pay.busy}>やめる</button>
              <button type="button" className="btn primary" onClick={confirmPay} disabled={pay.busy}>
                {pay.busy ? "払っています…" : "払う"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
