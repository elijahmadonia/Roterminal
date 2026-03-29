import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { TOKENS } from '../../design/marketTokens'

export type BreadcrumbItem = {
  label: string
  onClick?: () => void
  icon?: ReactNode
}

type BreadcrumbsProps = {
  items: BreadcrumbItem[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: TOKENS.spacing.xs,
      }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        const content = (
          <>
            {item.icon}
            <span>{item.label}</span>
          </>
        )

        return (
          <div
            key={`${item.label}-${index}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: TOKENS.spacing.xs,
            }}
          >
            {item.onClick && !isLast ? (
              <button
                type="button"
                onClick={item.onClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  border: 0,
                  background: 'transparent',
                  color: TOKENS.colors.neutral2,
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                  fontWeight: 500,
                  transition: `color ${TOKENS.transitions.fast}`,
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.color = TOKENS.colors.neutral1
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.color = TOKENS.colors.neutral2
                }}
              >
                {content}
              </button>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: isLast ? TOKENS.colors.neutral1 : TOKENS.colors.neutral2,
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                  fontWeight: 500,
                }}
              >
                {content}
              </span>
            )}

            {!isLast ? (
              <ChevronRight size={14} color={TOKENS.colors.neutral3} />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
