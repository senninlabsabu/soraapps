import { Icon } from "./Icon";

// 星の表示（平均 0〜5）。評価がないときは「評価なし」
export function Stars({ value, count }: { value: number; count: number }) {
  if (!count) return <span className="muted small">評価なし</span>;
  return (
    <span className="stars" aria-label={`5つ星中 ${value}、${count}件`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={14} className={n <= Math.round(value) ? "star on" : "star"} />
      ))}
      <span className="small muted star-text">
        {value.toFixed(1)}（{count}）
      </span>
    </span>
  );
}

export const priceLabel = (price: number) => (price === 0 ? "無料" : `${price.toLocaleString("ja-JP")} pt`);
