import { useState } from 'react'

import { TOKENS } from '../../design/marketTokens'

type UnderlineTabsProps<T extends string> = {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}

export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
}: UnderlineTabsProps<T>) {
  const [hovered, setHovered] = useState<T | null>(null)

  return (
    <div
      style={{
        display: 'flex',
        gap: TOKENS.spacing.lg,
      }}
    >
      {options.map((option) => {
        const active = value === option

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            onMouseEnter={() => setHovered(option)}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '0 0 8px',
              border: 'none',
              background: 'transparent',
              color:
                active || hovered === option
                  ? TOKENS.colors.neutral1
                  : TOKENS.colors.neutral2,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: TOKENS.typography.heading2.size,
              lineHeight: TOKENS.typography.heading2.lineHeight,
              fontWeight: TOKENS.typography.heading2.weight,
              letterSpacing: TOKENS.typography.heading2.letterSpacing,
              transition: `color ${TOKENS.transitions.fast}`,
            }}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
