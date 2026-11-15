import { useEffect, useState } from "react";
import { errorText } from "../api";
import { Icon } from "./Icon";

// 支払いの確認シート（Google Pay のように、下から出て「支払う」を押すまで何も動かさない）
export function PaySheet({
  open,
  title,
  amount,
  balance,
  note,
  actionLabel,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  amount: number;
  balance: number | null;
  note?: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに、エラーを消す
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  if (!open) return null;

  const enough = balance === null || balance >= amount;
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div className="pay-sheet" role="dialog" aria-modal="true" aria-label={`${title}の支払い`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="pay-sheet-head">
          <span className="pay-sheet-title">{title}</span>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="閉じる">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="pay-amount-big">{amount.toLocaleString("ja-JP")}<span> pt</span></div>
        {note && <p className="pay-note">{note}</p>}

        <div className="pay-method">
          <span className="pay-method-icon" aria-hidden="true">pt</span>
          <div className="pay-method-body">
            <strong>仙人ポイント</strong>
            <span className="small muted">
              {balance === null ? "残高を確認できません" : `残高 ${balance.toLocaleString("ja-JP")} pt${enough ? "" : "（足りません）"}`}
            </span>
          </div>
          <span className="pay-method-chevron" aria-hidden="true">›</span>
        </div>

        {error && <p className="notice error">{error}</p>}
        <button type="button" className="btn primary pill block big" onClick={pay} disabled={busy || !enough}>
          {busy ? "処理中…" : actionLabel}
        </button>
        <button type="button" className="btn ghost pill block" onClick={onClose} disabled={busy}>
          やめる
        </button>
      </div>
    </div>
  );
}
