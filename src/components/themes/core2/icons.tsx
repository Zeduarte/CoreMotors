/** Os ícones do Stock do Core2 (traço, na cor do texto), como nas maquetes. */

export type Core2IconName = "sliders" | "chevron" | "arrow" | "search" | "reset" | "close";

const PATHS: Record<Core2IconName, React.ReactNode> = {
  sliders: (
    <>
      <path d="M3 6h10M17 6h4M3 12h4M11 12h10M3 18h12M19 18h2" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  chevron: <path d="m6 15 6-6 6 6" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  reset: (
    <>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
      <path d="M5 3v5h5M19 21v-5h-5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Core2Icon({
  name,
  className = "",
  strokeWidth = 2,
}: {
  name: Core2IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
