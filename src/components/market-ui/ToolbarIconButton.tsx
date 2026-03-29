import type { ReactNode } from 'react'
import { useState } from 'react'

import { TOKENS } from '../../design/marketTokens'

type ToolbarIconButtonProps = {
  icon: ReactNode
  label: string
}

export function ToolbarIconButton({
  icon,
  label,
}: ToolbarIconButtonProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '56px',
        height: '56px',
        borderRadius: '20px',
        border: `1px solid ${
          hovered ? `${TOKENS.colors.neutral4}AA` : `${TOKENS.colors.neutral4}66`
        }`,
        background: hovered ? TOKENS.colors.surface2 : TOKENS.colors.surface1,
        color: TOKENS.colors.neutral1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: `background ${TOKENS.transitions.fast}, border-color ${TOKENS.transitions.fast}`,
      }}
    >
      {icon}
    </button>
  )
}
