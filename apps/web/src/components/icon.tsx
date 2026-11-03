import type { ReactNode } from "react";

const paths = {
  grid: <><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 9h6m-6 3h6m-6 3h4m5-6h1m-1 3h1"/></>,
  camera: <><circle cx="12" cy="9.5" r="5.5"/><circle cx="12" cy="9.5" r="2"/><path d="M12 15v3m-5 3h10l-2-3H9z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  queries: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 12.5v-2m2.5 2V8m2.5 4.5v-3"/></>,
  route: <><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 15V7a3 3 0 0 1 3-3h2m7 5v8a3 3 0 0 1-3 3h-2"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 4v4.5H8M12 8v4l3 2"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  back: <path d="m15 5-7 7 7 7"/>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
  target: <><circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>,
  car: <><path d="M5 11 6.6 6.5A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M5 17v2.5M19 17v2.5M7 14h1.5m7 0H17"/></>,
  motorcycle: <><circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 10 9h4l4.5 7M14 9l-1.5-3H10m2 10h-1.5L14 9"/></>,
  activity: <path d="M3 15l4-5 4 4 4-6 3 3 3-3"/>,
  signal: <><circle cx="12" cy="13" r="1.6"/><path d="M8.6 16.4a4.8 4.8 0 1 1 6.8 0M5.6 19.4a9 9 0 1 1 12.8 0"/></>,
  layers: <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 5 5 9-10"/>,
  key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></>,
  user: <><circle cx="10" cy="8" r="4"/><path d="M3 20a7 7 0 0 1 10.5-6"/><circle cx="18" cy="17" r="2.2"/><path d="M18 13.3v1.5m0 4.4v1.5m3.7-3.7h-1.5m-4.4 0h-1.5"/></>,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  alert: <><path d="M12 3 2 20h20Z"/><path d="M12 10v4m0 3v.5"/></>,
  phone: <><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></>,
  fingerprint: <><path d="M12 11v3.5a6 6 0 0 1-1.6 4.1M8.4 7.2A5 5 0 0 1 17 11v2.5m-.4 3.7c-.3 1-.7 1.9-1.3 2.8M7 11a5 5 0 0 1 .5-2.2M7 14.5v-.5"/><path d="M4.6 15.5A10 10 0 0 1 4 11a8 8 0 0 1 12-6.9M19.4 8a8 8 0 0 1 .6 3v1"/></>,
  cable: <><path d="M7 3v4M11 3v4M5.5 7h7v3a3.5 3.5 0 0 1-7 0zM9 13.5V16a4 4 0 0 0 4 4h1a4 4 0 0 0 4-4V8"/><path d="M16 5.5 18 3l2 2.5"/></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
