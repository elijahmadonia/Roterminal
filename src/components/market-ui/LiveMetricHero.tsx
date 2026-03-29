import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'

import { TOKENS } from '../../design/marketTokens'
import { LiveLineChart } from './LiveLineChart'
import { Skeleton } from './Skeleton'

type LiveMetricHeroProps = {
  label: string
  labelStyle?: {
    size: string
    lineHeight: string
    weight: number
    letterSpacing: string
  }
  value: ReactNode
  valueStyle?: {
    fontSize: string
    lineHeight: string
    fontWeight: number
    letterSpacing: string
  }
  change?: ReactNode
  subtitle?: string
  headerTrailing?: ReactNode
  labelTrailing?: ReactNode
  points: number[]
  tone?: 'positive' | 'negative' | 'neutral'
  chartColor?: string
  chartHeight?: number
  chart?: ReactNode
  loading?: boolean
}

export function LiveMetricHero({
  label,
  labelStyle = TOKENS.typography.body3,
  value,
  valueStyle = {
    fontSize: '48px',
    lineHeight: '48px',
    fontWeight: 500,
    letterSpacing: '-0.03em',
  },
  change,
  subtitle,
  headerTrailing,
  labelTrailing,
  points,
  tone = 'positive',
  chartColor,
  chartHeight = 250,
  chart,
  loading = false,
}: LiveMetricHeroProps) {
  const accentColor =
    tone === 'positive'
      ? TOKENS.colors.success
      : tone === 'negative'
        ? TOKENS.colors.critical
        : TOKENS.colors.neutral2

  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
      <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
        {loading ? (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: TOKENS.spacing.md,
                flexWrap: 'wrap',
              }}
            >
              <Skeleton width="220px" height="56px" />
              {headerTrailing ? (
                <Skeleton width="300px" height="48px" radius={TOKENS.radii.lg} />
              ) : null}
            </div>
            <Skeleton width="108px" height="18px" />
            {change ? <Skeleton width="120px" height="20px" /> : null}
          </>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: TOKENS.spacing.md,
                flexWrap: 'wrap',
              }}
            >
              <strong
                style={{
                  fontSize: valueStyle.fontSize,
                  lineHeight: valueStyle.lineHeight,
                  fontWeight: valueStyle.fontWeight,
                  letterSpacing: valueStyle.letterSpacing,
                }}
              >
                {value}
              </strong>
              {headerTrailing}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: TOKENS.spacing.md,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  color: TOKENS.colors.neutral2,
                  fontSize: labelStyle.size,
                  lineHeight: labelStyle.lineHeight,
                  fontWeight: labelStyle.weight,
                  letterSpacing: labelStyle.letterSpacing,
                }}
              >
                {label}
              </span>
              {labelTrailing}
            </div>
            {change ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: accentColor,
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                  fontWeight: 600,
                }}
              >
                {tone === 'positive' ? (
                  <TrendingUp size={14} />
                ) : tone === 'negative' ? (
                  <TrendingDown size={14} />
                ) : (
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: TOKENS.radii.pill,
                      background: accentColor,
                    }}
                  />
                )}
                {change}
              </span>
            ) : null}
          </>
        )}
        {!loading && subtitle ? (
          <span
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>

      <div
        style={{
          position: 'relative',
          minHeight: `${chartHeight}px`,
        }}
      >
        {loading && !chart ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              alignContent: 'end',
              gap: '10px',
              paddingBottom: '16px',
            }}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton
                key={`hero-chart-skeleton-${index}`}
                width={`${72 + (index % 3) * 7}%`}
                height="2px"
                radius="999px"
                style={{
                  opacity: 0.7 - index * 0.08,
                  marginLeft: `${(index % 2) * 6}%`,
                }}
              />
            ))}
          </div>
        ) : (
          chart ?? (
            <LiveLineChart
              points={points}
              tone={tone}
              color={chartColor}
              height={chartHeight}
              loading={loading}
            />
          )
        )}
      </div>
    </div>
  )
}
