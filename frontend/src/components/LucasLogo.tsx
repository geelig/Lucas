import { useId } from 'react';

export function LucasLogo({ size = 24, title = 'Lucas' }: { size?: number; title?: string }) {
  const gradientId = useId();
  return <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}>
    <title>{title}</title>
    <defs><linearGradient id={gradientId} x1="8" y1="7" x2="24" y2="25" gradientUnits="userSpaceOnUse"><stop stopColor="#5EEAD4" /><stop offset="1" stopColor="#60A5FA" /></linearGradient></defs>
    <rect x="1" y="1" width="30" height="30" rx="8" fill="#1C1F24" stroke="rgba(255,255,255,.14)" />
    <path d="M8 10h16M8 16h16M8 22h16" fill="none" stroke={`url(#${gradientId})`} strokeWidth="2.1" strokeLinecap="round" />
    <circle cx="12.5" cy="10" r="2.5" fill={`url(#${gradientId})`} />
    <circle cx="19" cy="16" r="2.5" fill={`url(#${gradientId})`} />
    <circle cx="11" cy="22" r="2.5" fill={`url(#${gradientId})`} />
  </svg>;
}
