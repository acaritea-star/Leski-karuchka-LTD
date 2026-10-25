const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  arrowRight: 'M4 12h16m-6-6 6 6-6 6',
  car: 'm5 7 2-4h10l2 4M4 7h16l1 5v7h-4v-3H7v3H3v-7l1-5ZM3 12h18M6 9h1m10 0h1',
  back: 'm11 5-7 7 7 7M4 12h16',
  locate: 'M12 2v3m0 14v3M2 12h3m14 0h3M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
  arrowUpRight: 'M6 18 18 6M6 6h12v12',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  phone: 'M5 3h4l2 5-3 2a16 16 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  orders: 'M7 4H4v17h16V4h-3M8 3h8v4H8ZM8 12h8M8 16h5',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 5 0 0 1 16 0v2',
  settings: 'M4 6h4m4 0h8M4 12h10m4 0h2M4 18h2m4 0h10M8 3v6M14 9v6M6 15v6',
  help: 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  document: 'M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8M8 16h8',
  logout: 'M9 4H4v16h5m6-13 5 5-5 5M8 12h12',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l4 2',
} as const;
export type IconName = keyof typeof paths;

/** Critical controls remain visible even when the optional icon font is offline. */
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`ui-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
