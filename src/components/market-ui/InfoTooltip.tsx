import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { TOKENS } from '../../design/marketTokens'

type InfoTooltipProps = {
  trigger: ReactNode
  ariaLabel: string
  title: ReactNode
  description: ReactNode
  icon?: ReactNode
  minWidth?: number
  maxWidth?: number
}

export function InfoTooltip({
  trigger,
  ariaLabel,
  title,
  description,
  icon,
  minWidth = 220,
  maxWidth = 240,
}: InfoTooltipProps) {
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    if (!showTooltip) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!tooltipRef.current?.contains(event.target as Node)) {
        setShowTooltip(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [showTooltip])

  return (
    <span
      ref={tooltipRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setShowTooltip((current) => !current)
        }}
        style={{
          appearance: 'none',
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {trigger}
      </button>

      {showTooltip ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'calc(100% + 10px)',
            transform: 'translateX(-50%)',
            minWidth: `${minWidth}px`,
            maxWidth: `${maxWidth}px`,
            padding: '12px 14px',
            borderRadius: TOKENS.radii.xxl,
            background: TOKENS.colors.surface1,
            border: `1px solid ${TOKENS.colors.surface3}`,
            color: TOKENS.colors.neutral1,
            boxShadow: TOKENS.shadows.menu,
            zIndex: 30,
            display: 'grid',
            justifyItems: 'center',
            gap: TOKENS.spacing.xs,
            textAlign: 'center',
          }}
        >
          {icon ? (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </span>
          ) : null}
          <span
            style={{
              fontSize: TOKENS.typography.heading3.size,
              lineHeight: TOKENS.typography.heading3.lineHeight,
              fontWeight: TOKENS.typography.heading3.weight,
              letterSpacing: TOKENS.typography.heading3.letterSpacing,
            }}
          >
            {title}
          </span>
          <span
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
              whiteSpace: 'normal',
            }}
          >
            {description}
          </span>
        </span>
      ) : null}
    </span>
  )
}
