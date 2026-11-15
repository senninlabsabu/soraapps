import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorText } from "../api";
import { Icon } from "../components/Icon";
import { ORDER_STATUS_LABEL, type OrderDetail as Detail } from "../types";

const POLL_MS = 5000;

// 取引の詳細：受け取り・受け渡しの確認と、出品者とのDM。
// 両者が受け取り済みにするまで、代金は作者へ入金されない（預かり中）。
export function OrderDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/orders/${id}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 取引が続いている間は、相手の DM と確認を定期的に読み直す
  const open = data?.order.status === "open";
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, load]);

  // 新しいメッセージが来たら、一番下へ
  const messageCount = data?.messages.length ?? 0;
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

  const act = async (path: string, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await api(`/api/orders/${id}/${path}`, { method: "POST" });
      setNotice(ok);
      await load();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setNotice(null);
    try {
      await api(`/api/orders/${id}/messages`, { method: "POST", json: { body } });
      setText("");
      await load();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const { order, app } = data;
  const isBuyer = order.role === "buyer";
  const status = order.status;
  const cancelLabel = status === "cancelled" && !order.refunded ? "返金をやり直す" : "キャンセルして返金";
  const steps = [
    { label: "代金を預かり", done: status !== "pending_payment" },
    { label: "受け渡し（両者の確認）", done: order.buyerConfirmed && order.sellerConfirmed },
    { label: "作者へ入金", done: status === "completed" }
  ];

  return (
    <div className="order-page">
      <Link to="/orders" className="back small"><Icon name="back" size={16} /> 注文・取引</Link>

      <section className="pay-card">
        <div className="pay-card-head">
          <div className="order-thumb big">
            {app?.thumbUrl ? <img src={app.thumbUrl} alt="" /> : <span>{(app?.name ?? "商").slice(0, 1)}</span>}
          </div>
          <div className="pay-card-info">
            <span className="small muted">{isBuyer ? "購入" : "販売"}・{app?.kindLabel ?? "手渡しグッズ"}</span>
            <strong className="pay-card-title">{app?.name ?? "商品"}</strong>
            <span className="small muted">{isBuyer ? "出品者" : "購入者"}：{data.counterpartName}</span>
          </div>
          <span className={`status-chip s-${status}`}>{ORDER_STATUS_LABEL[status]}</span>
        </div>
        <div className="pay-card-amount">
          <span className="muted small">{isBuyer ? "支払った金額" : "受け取る金額（入金は受け渡し後）"}</span>
          <strong>{order.amount.toLocaleString("ja-JP")}<span> pt</span></strong>
        </div>

        <ol className="stepper" aria-label="取引の進み具合">
          {steps.map((s, i) => (
            <li key={i} className={s.done ? "done" : ""}>
              <span className="step-dot" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="confirm-grid">
          <div className={`confirm-item${order.buyerConfirmed ? " on" : ""}`}>
            <span className="small muted">購入者</span>
            <strong>{order.buyerConfirmed ? "受け取り済み" : "未確認"}</strong>
          </div>
          <div className={`confirm-item${order.sellerConfirmed ? " on" : ""}`}>
            <span className="small muted">出品者</span>
            <strong>{order.sellerConfirmed ? "渡し済み" : "未確認"}</strong>
          </div>
        </div>

        {status === "open" && (
          <p className="small pay-hint">
            両者が受け取り済みにするまで、代金は預かったままです。作者への入金は、そろってから行われます。
          </p>
        )}
        {status === "completed" && <p className="notice ok">受け渡しが完了しました。代金は作者へ入金されました。</p>}
        {status === "cancelled" && (
          <p className="notice warn">
            この注文はキャンセルされました。
            {order.refunded ? "預かっていた代金は、購入者へ返金されました。" : "返金がまだ完了していません。下のボタンから、もう一度お試しください。"}
          </p>
        )}
        {status === "pending_payment" && <p className="notice">支払いを確認しています。少し待つと、ここに反映されます。</p>}

        <div className="detail-actions">
          {data.canConfirm && (
            <button type="button" className="btn primary pill big" disabled={busy} onClick={() => act("confirm", isBuyer ? "受け取りを記録しました。" : "受け渡しを記録しました。")}>
              {isBuyer ? "受け取りました" : "渡しました"}
            </button>
          )}
          {data.canCancel && (
            <button type="button" className="btn ghost pill danger" disabled={busy} onClick={() => {
              if (window.confirm("この注文をキャンセルし、代金を返金しますか？")) void act("cancel", "キャンセルしました。");
            }}>
              {cancelLabel}
            </button>
          )}
        </div>
        {notice && <p className="notice">{notice}</p>}
      </section>

      {app?.handoverNote && (
        <section className="handover-card">
          <h2 className="section-title">受け渡しの目安</h2>
          <p className="small">{app.handoverNote}</p>
        </section>
      )}

      <section className="thread" aria-label="DM">
        <header className="thread-head">
          <span className="avatar small-avatar" aria-hidden="true">{data.counterpartName.slice(0, 1)}</span>
          <div>
            <strong>{data.counterpartName}</strong>
            <span className="small muted"> とのDM</span>
          </div>
        </header>
        <div className="thread-body">
          {data.messages.length === 0 && (
            <p className="small muted center">受け渡しの日時と場所を相談しましょう。</p>
          )}
          {data.messages.map((m) => (
            <div key={m.id} className={`bubble-row${m.mine ? " mine" : ""}`}>
              <div className={`bubble${m.mine ? " mine" : ""}`}>
                <p>{m.body}</p>
                <span className="bubble-time">{new Date(m.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          ))}
          <div ref={threadEnd} />
        </div>
        {data.canMessage ? (
          <form
            className="thread-input"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="メッセージ（500文字まで。URL・連絡先は書けません）"
              maxLength={500}
              rows={1}
              aria-label="メッセージ"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <button type="submit" className="btn primary pill" disabled={busy || !text.trim()} aria-label="送信">
              <Icon name="send" size={18} />
            </button>
          </form>
        ) : (
          <p className="small muted thread-closed">この取引は終わっているため、メッセージは送れません。</p>
        )}
      </section>
    </div>
  );
}
