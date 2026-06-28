interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { icon: 23, text: '1.1rem' },
  md: { icon: 29, text: '1.35rem' },
  lg: { icon: 36, text: '1.75rem' },
}

export function LogoIcon({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" className={className ?? 'flex-shrink-0'}>
      <rect width="22" height="22" rx="5" fill="#112240"/>
      <text
        x="2.5" y="16.5"
        fontFamily="system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
        fontSize="14" fontWeight="800" fill="white"
      >p</text>
      <rect x="13.5" y="5.5" width="6.5" height="2" rx="1" fill="white"/>
      <rect x="13.5" y="9.5" width="6.5" height="2" rx="1" fill="white"/>
      <rect x="13.5" y="13.5" width="6.5" height="2" rx="1" fill="white"/>
    </svg>
  )
}

export default function Logo({ size = 'md' }: LogoProps) {
  const { icon, text } = sizes[size]
  return (
    <div className="flex items-center gap-2 select-none">
      <LogoIcon size={icon} />

      <span
        className="text-gray-900 dark:text-white"
        style={{
          fontFamily: '"Cormorant Garamond", Lora, Georgia, serif',
          fontStyle: 'italic',
          fontWeight: 700,
          fontSize: text,
          letterSpacing: '0.01em',
          lineHeight: 1,
        }}
      >
        Pilotbase
      </span>
    </div>
  )
}
