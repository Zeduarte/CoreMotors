/** Os ícones do tema Core2 (traço, na cor do texto), como nas maquetes. */

export type Core2IconName =
  | "sliders"
  | "chevron"
  | "arrow"
  | "search"
  | "reset"
  | "close"
  | "tag"
  | "refresh"
  | "truck"
  | "card"
  | "pin"
  | "phone"
  | "mail"
  | "facebook";

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
  tag: (
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 9A8.5 8.5 0 0 0 5 6.3L3.5 8" />
      <path d="M3.5 3.5V8H8" />
      <path d="M3.5 15A8.5 8.5 0 0 0 19 17.7l1.5-1.7" />
      <path d="M20.5 20.5V16H16" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7z" />
      <circle cx="6.5" cy="17" r="1.8" />
      <circle cx="17" cy="17" r="1.8" />
      <path d="M5 10h6" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6 15h4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  phone: (
    <path d="M5 3.5h3.2l1.6 4.2-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4.2 1.6V17a2 2 0 0 1-2 2A15.5 15.5 0 0 1 3 5.5a2 2 0 0 1 2-2z" />
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m3 6.5 9 6.5 9-6.5" />
    </>
  ),
  facebook: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M13.2 20.5v-7h2.4l.4-2.8h-2.8V9c0-.8.3-1.4 1.4-1.4H16V5.2a17 17 0 0 0-2.2-.1c-2.2 0-3.6 1.3-3.6 3.7v1.9H7.8v2.8h2.4v7" />
    </>
  ),
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
