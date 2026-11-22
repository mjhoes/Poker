/** Small stroke icon set on a shared 24px grid. Inline SVG so it works offline and inherits currentColor. */
const paths = {
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.4" /></>,
  warning: <><path d="M12 3.8L2.8 19.5h18.4z" /><path d="M12 10v4.4M12 17v.4" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10.3 10.5v6M13.7 10.5v6" /></>,
  door: <><path d="M14 4H6.5v16H14" /><path d="M11 12h9M17 8.8l3.2 3.2-3.2 3.2" /></>,
  restore: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.2 4.5v4.2h4.2" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[name]}
  </svg>;
}
