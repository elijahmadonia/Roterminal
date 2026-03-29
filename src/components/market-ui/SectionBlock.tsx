import type { ReactNode } from 'react'

import { TOKENS } from '../../design/marketTokens'

type SectionBlockProps = {
  title: string
  subtitle?: string
  children: ReactNode
}

export function SectionBlock({
  title,
  subtitle,
  children,
}: SectionBlockProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: TOKENS.spacing.md,
        paddingTop: TOKENS.spacing.sm,
        borderTop: `1px solid ${TOKENS.colors.surface3}`,
      }}
    >
      <div style={{ display: 'grid', gap: '4px' }}>
        <h2
          style={{
            margin: 0,
            fontSize: TOKENS.typography.heading2.size,
            lineHeight: TOKENS.typography.heading2.lineHeight,
            fontWeight: 500,
            letterSpacing: TOKENS.typography.heading2.letterSpacing,
          }}
        >
          {title}
        </h2>
        {subtitle ? (
          <p
            style={{
              margin: 0,
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {children}
    </section>
  )
}
