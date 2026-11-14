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
  chevron: "M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"
};

export function Icon({ name, size = 20, className }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}
