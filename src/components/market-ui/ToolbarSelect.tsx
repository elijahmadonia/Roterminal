import type { ReactNode } from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { TOKENS } from '../../design/marketTokens'

type ToolbarSelectProps = {
  label: string
  leading?: ReactNode
  compact?: boolean
}

export function ToolbarSelect({
  label,
  leading,
  compact = false,
}: ToolbarSelectProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? TOKENS.spacing.sm : TOKENS.spacing.md,
        minHeight: compact ? '48px' : '56px',
        padding: compact ? '0 14px' : '0 18px',
        borderRadius: '20px',
        border: `1px solid ${
          hovered ? `${TOKENS.colors.neutral4}AA` : `${TOKENS.colors.neutral4}66`
        }`,
        background: hovered ? TOKENS.colors.surface2 : TOKENS.colors.surface1,
        color: TOKENS.colors.neutral1,
        fontFamily: 'inherit',
        fontSize: compact
          ? TOKENS.typography.body2.size
          : TOKENS.typography.heading2.size,
        fontWeight: compact ? 500 : 400,
        lineHeight: compact
          ? TOKENS.typography.body2.lineHeight
          : TOKENS.typography.heading2.lineHeight,
        cursor: 'pointer',
        transition: `background ${TOKENS.transitions.fast}, border-color ${TOKENS.transitions.fast}`,
      }}
    >
      {leading ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {leading}
        </span>
      ) : null}
      <span>{label}</span>
      <ChevronDown
        size={compact ? 18 : 20}
        color={hovered ? TOKENS.colors.neutral1 : TOKENS.colors.neutral2}
        style={{ flexShrink: 0 }}
      />
    </button>
  )
}
