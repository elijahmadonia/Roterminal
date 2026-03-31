import { useState } from 'react'

import { TOKENS } from '../../design/marketTokens'

type SegmentedControlProps<T extends string> = {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: SegmentedControlProps<T>) {
  const [hovered, setHovered] = useState<T | null>(null)

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '3px',
        maxWidth: '100%',
        padding: '3px',
        borderRadius: TOKENS.radii.pill,
        border: `1px solid ${TOKENS.colors.neutral4}66`,
        background: 'transparent',
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
              minHeight: size === 'sm' ? '30px' : '34px',
              padding: size === 'sm' ? '0 12px' : '0 14px',
              flexShrink: 0,
              border: 'none',
              borderRadius: TOKENS.radii.pill,
              background:
                active
                  ? TOKENS.colors.surface4
                  : hovered === option
                    ? TOKENS.colors.surface2
                    : 'transparent',
              color:
                active || hovered === option
                  ? TOKENS.colors.neutral1
                  : TOKENS.colors.neutral2,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize:
                size === 'sm'
                  ? TOKENS.typography.body3.size
                  : TOKENS.typography.body2.size,
              lineHeight:
                size === 'sm'
                  ? TOKENS.typography.body3.lineHeight
                  : TOKENS.typography.body2.lineHeight,
              fontWeight: 600,
              transition: `background ${TOKENS.transitions.fast}, color ${TOKENS.transitions.fast}`,
            }}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
