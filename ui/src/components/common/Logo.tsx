interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { icon: 18, text: '1.1rem' },
  md: { icon: 22, text: '1.35rem' },
  lg: { icon: 28, text: '1.75rem' },
}

export default function Logo({ size = 'md' }: LogoProps) {
  const { icon, text } = sizes[size]
  return (
    <div className="flex items-center gap-2 select-none">
      {/* Pilot / instrument icon */}
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent flex-shrink-0"
      >
        <path d="M12 2 L12 7" />
        <path d="M12 7 L6 18" />
        <path d="M12 7 L18 18" />
        <path d="M8 18 H16" />
        <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
      </svg>

      {/* Wordmark — Cormorant Garamond italic */}
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
