import type { CSSProperties, ReactNode } from 'react'

import { TOKENS } from '../../design/marketTokens'
import { Skeleton } from './Skeleton'

type SurfacePanelProps = {
  title?: string
  subtitle?: string
  children: ReactNode
  trailing?: ReactNode
  style?: CSSProperties
  loading?: boolean
  skeletonRows?: number
}

export function SurfacePanel({
  title,
  subtitle,
  children,
  trailing,
  style,
  loading = false,
  skeletonRows = 4,
}: SurfacePanelProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: TOKENS.spacing.md,
        padding: TOKENS.spacing.lg,
        borderRadius: TOKENS.radii.xxl,
        border: `1px solid ${TOKENS.colors.surface3}`,
        background: TOKENS.colors.surface2,
        ...style,
      }}
    >
      {title || trailing ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: TOKENS.spacing.md,
          }}
        >
          <div style={{ display: 'grid', gap: '4px' }}>
            {title ? (
              loading ? (
                <Skeleton width="120px" height="34px" radius="12px" />
              ) : (
                <h3
                  style={{
                    margin: 0,
                    color: TOKENS.colors.neutral1,
                    fontSize: TOKENS.typography.heading2.size,
                    lineHeight: TOKENS.typography.heading2.lineHeight,
                    fontWeight: 500,
                  }}
                >
                  {title}
                </h3>
              )
            ) : null}
            {!loading && subtitle ? (
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

          {trailing}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
          {Array.from({ length: skeletonRows }, (_, index) => (
            <div
              key={`surface-panel-skeleton-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: TOKENS.spacing.md,
              }}
            >
              <Skeleton width={index % 2 === 0 ? '120px' : '96px'} height="20px" />
              <Skeleton width={index % 2 === 0 ? '72px' : '104px'} height="20px" />
            </div>
          ))}
        </div>
      ) : (
        children
      )}
    </section>
  )
}
