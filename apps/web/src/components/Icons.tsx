/** Small stroke icon set on a shared 24px grid. Inline SVG so it works offline and inherits currentColor. */
const paths = {
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.4" /></>,
  warning: <><path d="M12 3.8L2.8 19.5h18.4z" /><path d="M12 10v4.4M12 17v.4" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10.3 10.5v6M13.7 10.5v6" /></>,
  door: <><path d="M14 4H6.5v16H14" /><path d="M11 12h9M17 8.8l3.2 3.2-3.2 3.2" /></>,
  restore: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.2 4.5v4.2h4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="M4.5 19.5l1-4.2L15.8 5a2.1 2.1 0 0 1 3 3L8.6 18.4z" /><path d="M13.8 7l3.1 3.1" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  "chevron-left": <path d="M14.5 6l-6 6 6 6" />,
  "chevron-right": <path d="M9.5 6l6 6-6 6" />,
  "chevron-down": <path d="M6 9.5l6 6 6-6" />,
  cards: <><rect x="3.5" y="6" width="10" height="14" rx="1.6" /><path d="M9.5 4.6l1.2-.4a1.6 1.6 0 0 1 2 1l3.9 11.4a1.6 1.6 0 0 1-1 2l-1.1.4" /><path d="M16 4.5l2.2.3a1.6 1.6 0 0 1 1.4 1.8l-1.2 9" /></>,
  draw: <><path d="M4.5 12h11" /><path d="M12 7.5l4.5 4.5-4.5 4.5" /><path d="M19.5 5v14" /></>,
  download: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  upload: <><path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9" /><path d="M5 19.5h14" /></>,
  wallet: <><path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><path d="M4 7.5L15.5 4.5V7.5" /><circle cx="16" cy="13.5" r="1" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /><circle cx="12" cy="12" r="6.4" /></>,
  more: <><circle cx="5.5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5v8A1.5 1.5 0 0 0 6 14.5h.5" /></>,
  sparkle: <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z" />,
  transfer: <><path d="M5 8.5h13M14.5 5l3.5 3.5-3.5 3.5" /><path d="M19 15.5H6M9.5 12L6 15.5 9.5 19" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[name]}
  </svg>;
}
