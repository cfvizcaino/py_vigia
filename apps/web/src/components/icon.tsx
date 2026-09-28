import type { ReactNode } from "react";

const paths = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  camera: <><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/><circle cx="9.5" cy="12" r="2.5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  route: <><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 15V7a3 3 0 0 1 3-3h2m7 5v8a3 3 0 0 1-3 3h-2"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></>,
  car: <><path d="m5 9 2-5h10l2 5M3 10h18v8H3zM6 18v3m12-3v3M6 13h2m8 0h2"/></>,
  activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
  layers: <><path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
