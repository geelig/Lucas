export function FinderFolder({ size = 18 }: { size?: number }) {
  return <svg className="finder-folder" width={size} height={size} viewBox="0 0 32 26" fill="none" aria-hidden="true">
    <defs><linearGradient id="lucas-finder-folder" x1="4" y1="3" x2="27" y2="24" gradientUnits="userSpaceOnUse"><stop stopColor="#82c8fa" /><stop offset="1" stopColor="#3594e8" /></linearGradient></defs>
    <path d="M2 6.5C2 4.57 3.57 3 5.5 3h6.3c1.05 0 2.05.43 2.78 1.2l1.5 1.55c.34.36.82.56 1.32.56h9.1C27.98 6.31 29 7.8 29 9.31v11.5c0 1.93-1.57 3.5-3.5 3.5h-20A4.5 4.5 0 0 1 1 19.81V6.5h1Z" fill="#2584d8" />
    <path d="M2.1 9.5h27.8c.7 0 1.17.68.96 1.34l-3.1 11.23a3.5 3.5 0 0 1-3.37 2.56H4.4a3.5 3.5 0 0 1-3.38-2.56L.02 11.2A1.08 1.08 0 0 1 1.07 9.5h1.03Z" fill="url(#lucas-finder-folder)" />
    <path d="M3 10h25.5" stroke="#b9e2ff" strokeOpacity=".65" strokeLinecap="round" />
  </svg>;
}
