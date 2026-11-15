// 画面の小さなアイコン（線画）。外部のアイコン用ライブラリには依存しない
const PATHS: Record<string, string> = {
  search: "M10 4a6 6 0 1 0 3.7 10.7l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
  home: "M12 3 3 10.5V21h6v-6h6v6h6V10.5z",
  grid: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  code: "M9 17 4 12l5-5-1.4-1.4L1.2 12l6.4 6.4zm6 0 5-5-5-5 1.4-1.4 6.4 6.4-6.4 6.4z",
  shield: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z",
  back: "M15.4 16.6 10.8 12l4.6-4.6L14 6l-6 6 6 6z",
  star: "M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z",
  close: "M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z",
  chevron: "M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z",
  wallet: "M3 6.5A1.5 1.5 0 0 1 4.5 5H19a2 2 0 0 1 2 2v1h-7a3 3 0 0 0 0 6h7v1.5a2 2 0 0 1-2 2H4.5A1.5 1.5 0 0 1 3 16.5zm11.5 4.5a1.5 1.5 0 1 0 0 3h1.5v-3z",
  orders: "M5 3h14v18H5zm2 2v14h10V5zm2 3h6v2H9zm0 4h6v2H9z",
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5a2.5 2.5 0 0 0-2.5 2.5zm2.5 14.5H18v-2H6.5a.5.5 0 0 0 0 1zM6 8h12v2H6z",
  image: "M4 4h16v16H4zm2 2v9.6l3.6-3.6 2.8 2.8 3.1-4 3.5 4.6V6zm4 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  bag: "M6 7h12l1 13H5zM9 7V5a3 3 0 0 1 6 0v2h-2V5a1 1 0 0 0-2 0v2z",
  send: "M3 11.5 21 3l-8.5 18-2.5-7.5z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  minus: "M5 11h14v2H5z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  store: "M3 9h18l-1.5-5h-15zM4 11v9h16v-9h-2v7H6v-7zm3 2h4v3H7z",
  chat: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
};

export function Icon({ name, size = 20, className }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}
