import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ExternalLink } from 'lucide-react'

import type {
  ChartRange,
  DetailComparableGame,
  DetailFinancialRange,
  DetailInventoryItem,
  DetailPortfolioGame,
  GameDetailResponse,
  TrendPoint,
} from '../types'
import { fetchGameLivePoint } from '../api/roblox'
import { GameImageIcon } from '../components/market-ui/GameImageIcon'
import { LiveLineChart } from '../components/market-ui/LiveLineChart'
import { LiveMetricHero } from '../components/market-ui/LiveMetricHero'
import { MarketButton } from '../components/market-ui/MarketButton'
import { PlayerHeatmap } from '../components/market-ui/PlayerHeatmap'
import { SegmentedControl } from '../components/market-ui/SegmentedControl'
import { Skeleton } from '../components/market-ui/Skeleton'
import { SurfacePanel } from '../components/market-ui/SurfacePanel'
import {
  ApprovalNumber,
  AnimatedNumber,
  CompactNumber,
  CurrencyNumber,
  PercentNumber,
  WholeNumber,
} from '../components/ui/AnimatedNumber'
import { TOKENS } from '../design/marketTokens'
import { useLiveBoard } from '../hooks/useLiveBoard'
import { useViewportWidth } from '../hooks/useViewportWidth'
import { useRollingLiveline } from '../hooks/useRollingLiveline'
import { generateGameShareCard } from '../utils/shareCard'
import {
  formatDate,
  formatSignedPercent,
} from '../utils/formatters'

type GamePageProps = {
  gameDetail: GameDetailResponse | null
  isLoading: boolean
  error: string | null
  chartRange: ChartRange
  availableRanges: ChartRange[]
  onChangeRange: (range: ChartRange) => void
  onOpenHeatPage: () => void
}

const CHART_RANGE_SECONDS: Record<ChartRange, number> = {
  '30m': 30 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
}

const SHARE_BACKGROUND_OPTIONS = [
  {
    id: 'blue',
    label: 'Blue Grid',
    url: '/share-backgrounds/blue-grid.png',
  },
  {
    id: 'pink',
    label: 'Pink Grid',
    url: '/share-backgrounds/pink-grid.png',
  },
] as const

const SHARE_VARIANT_OPTIONS = [
  {
    id: 'poster',
    label: 'Poster',
  },
  {
    id: 'split',
    label: 'Split',
  },
] as const

const GamePageCompactContext = createContext(false)

function toLiveLineData(points: TrendPoint[]) {
  const fallbackStart = Math.floor(Date.now() / 1000) - points.length * 300

  return points.map((point, index) => {
    const parsedTimestamp = point.timestamp ? Date.parse(point.timestamp) : Number.NaN

    return {
      time: Number.isNaN(parsedTimestamp)
        ? fallbackStart + index * 300
        : Math.floor(parsedTimestamp / 1000),
      value: point.value,
    }
  })
}

function getCoverageSeconds(points: Array<{ time: number }>) {
  if (points.length <= 1) {
    return 0
  }

  return Math.max((points.at(-1)?.time ?? 0) - (points[0]?.time ?? 0), 0)
}

function formatDurationCompact(totalSeconds: number) {
  const roundedMinutes = Math.max(Math.round(totalSeconds / 60), 0)

  if (roundedMinutes < 60) {
    return `${roundedMinutes}m`
  }

  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60

  if (minutes === 0) {
    return `${hours}h`
  }

  return `${hours}h ${minutes}m`
}

function StatRow({
  label,
  value,
  stacked = false,
}: {
  label: string
  value: ReactNode
  stacked?: boolean
}) {
  const compactLayout = useContext(GamePageCompactContext)
  const shouldStack = stacked || compactLayout

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: shouldStack ? 'column' : 'row',
        alignItems: shouldStack ? 'flex-start' : 'baseline',
        justifyContent: 'space-between',
        gap: TOKENS.spacing.md,
      }}
    >
      <span
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body2.size,
          lineHeight: TOKENS.typography.body2.lineHeight,
        }}
      >
        {label}
      </span>
      <strong
        style={{
          color: TOKENS.colors.neutral1,
          fontSize: TOKENS.typography.body1.size,
          lineHeight: TOKENS.typography.body1.lineHeight,
          fontWeight: 500,
          textAlign: shouldStack ? 'left' : 'right',
          display: 'inline-flex',
          justifyContent: shouldStack ? 'flex-start' : 'flex-end',
          maxWidth: '100%',
          whiteSpace: shouldStack ? 'normal' : undefined,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </strong>
    </div>
  )
}

function SkeletonStatRows({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`skeleton-stat-row-${index}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: TOKENS.spacing.md,
          }}
        >
          <Skeleton
            width={index % 3 === 0 ? '112px' : index % 3 === 1 ? '136px' : '96px'}
            height="16px"
            radius={TOKENS.radii.sm}
          />
          <Skeleton
            width={index % 2 === 0 ? '84px' : '108px'}
            height="18px"
            radius={TOKENS.radii.sm}
          />
        </div>
      ))}
    </div>
  )
}

function PairedMetricBoxSkeleton({ stacked = false }: { stacked?: boolean }) {
  const itemWidths = ['96px', '112px', '88px', '120px']
  const compactLayout = useContext(GamePageCompactContext)
  const shouldStack = stacked || compactLayout

  return (
    <div
      style={{
        borderRadius: TOKENS.radii.xxl,
        border: `1px solid ${TOKENS.colors.surface3}`,
        overflow: 'hidden',
        background: TOKENS.colors.surface1,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: shouldStack ? '1fr' : 'repeat(2, minmax(0, 1fr))',
        }}
      >
        {itemWidths.map((width, index) => (
          <div
            key={`paired-metric-skeleton-${index}`}
            style={{
              display: 'grid',
              gap: TOKENS.spacing.xs,
              padding: TOKENS.spacing.lg,
              borderLeft:
                !shouldStack && index % 2 === 1 ? `1px solid ${TOKENS.colors.surface3}` : 'none',
              borderTop:
                shouldStack
                  ? index > 0
                    ? `1px solid ${TOKENS.colors.surface3}`
                    : 'none'
                  : index > 1
                    ? `1px solid ${TOKENS.colors.surface3}`
                    : 'none',
            }}
          >
            <Skeleton width={width} height="18px" radius={TOKENS.radii.sm} />
            <Skeleton
              width={index % 2 === 0 ? '124px' : '146px'}
              height="28px"
              radius={TOKENS.radii.md}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function EstimatedValueSkeleton() {
  return (
    <SurfacePanel style={{ gap: TOKENS.spacing.lg, border: 'none' }}>
      <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
        <Skeleton width="132px" height="18px" radius={TOKENS.radii.sm} />
        <Skeleton width="188px" height="36px" radius={TOKENS.radii.md} />
        <div style={{ display: 'grid', gap: '6px' }}>
          <Skeleton width="100%" height="16px" radius={TOKENS.radii.sm} />
          <Skeleton width="78%" height="16px" radius={TOKENS.radii.sm} />
        </div>
      </div>
    </SurfacePanel>
  )
}

function StatsPanelSkeleton({ stacked = false }: { stacked?: boolean }) {
  const compactLayout = useContext(GamePageCompactContext)
  const shouldStack = stacked || compactLayout

  return (
    <SurfacePanel style={{ gap: TOKENS.spacing.lg, border: 'none' }}>
      <div style={{ display: 'grid', gap: TOKENS.spacing.lg }}>
        <Skeleton width="72px" height="28px" radius={TOKENS.radii.md} />
        <div style={{ display: 'grid', gap: TOKENS.spacing.xl }}>
          <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: shouldStack ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                gap: TOKENS.spacing.md,
              }}
            >
              <div style={{ display: 'grid', gap: '4px' }}>
                <Skeleton width="84px" height="28px" radius={TOKENS.radii.md} />
                <Skeleton width="52px" height="14px" radius={TOKENS.radii.sm} />
              </div>
              <div style={{ display: 'grid', gap: '4px', justifyItems: 'end' }}>
                <Skeleton width="84px" height="28px" radius={TOKENS.radii.md} />
                <Skeleton width="64px" height="14px" radius={TOKENS.radii.sm} />
              </div>
            </div>
            <Skeleton width="100%" height="14px" radius={TOKENS.radii.sm} />
          </div>

          <div style={{ display: 'grid', gap: TOKENS.spacing.xl }}>
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={`feature-metric-skeleton-${index}`}
                style={{ display: 'grid', gap: TOKENS.spacing.xs }}
              >
                <Skeleton
                  width={index === 1 ? '104px' : '88px'}
                  height="18px"
                  radius={TOKENS.radii.sm}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: TOKENS.spacing.sm }}>
                  <Skeleton
                    width={index === 2 ? '132px' : '116px'}
                    height="30px"
                    radius={TOKENS.radii.md}
                  />
                  <Skeleton width="74px" height="18px" radius={TOKENS.radii.sm} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SurfacePanel>
  )
}

function RawDataCardSkeleton({
  rows = 5,
  note = false,
}: {
  rows?: number
  note?: boolean
}) {
  return (
    <SurfacePanel>
      <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
        <Skeleton width="138px" height="26px" radius={TOKENS.radii.md} />
        <SkeletonStatRows rows={rows} />
        {note ? (
          <div style={{ display: 'grid', gap: '6px' }}>
            <Skeleton width="100%" height="14px" radius={TOKENS.radii.sm} />
            <Skeleton width="72%" height="14px" radius={TOKENS.radii.sm} />
          </div>
        ) : null}
      </div>
    </SurfacePanel>
  )
}

function VerifiedBadge() {
  return (
    <span
      aria-label="Verified"
      title="Verified"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        borderRadius: TOKENS.radii.pill,
        background: TOKENS.colors.base,
        color: '#FFFFFF',
        flexShrink: 0,
      }}
    >
      <Check size={12} strokeWidth={3} />
    </span>
  )
}

function renderWholeNumber(value: number | null | undefined, fallback = 'Unavailable') {
  return <WholeNumber value={value} fallback={fallback} />
}

function renderCompactNumber(value: number | null | undefined, fallback = 'Unavailable') {
  return <CompactNumber value={value} fallback={fallback} />
}

function renderPercent(
  value: number | null | undefined,
  {
    suffix = '%',
    signed = false,
    fallback = 'Unavailable',
  }: {
    suffix?: string
    signed?: boolean
    fallback?: ReactNode
  } = {},
) {
  return (
    <PercentNumber
      value={value}
      signed={signed}
      suffix={suffix}
      fallback={fallback}
    />
  )
}

function renderRobux(value: number | null | undefined, freeLabel = 'Free') {
  if (value == null) {
    return freeLabel
  }

  return (
    <>
      <WholeNumber value={value} /> R$
    </>
  )
}

function renderUsd(
  value: number | null | undefined,
  {
    compact = false,
    fallback = 'Unavailable',
  }: {
    compact?: boolean
    fallback?: ReactNode
  } = {},
) {
  if (compact) {
    return (
      <AnimatedNumber
        value={value}
        fallback={fallback}
        format={{
          style: 'currency',
          currency: 'USD',
          notation: 'compact',
          maximumFractionDigits: value != null && value >= 1_000_000 ? 1 : 0,
        }}
      />
    )
  }

  return (
    <CurrencyNumber
      value={value}
      currency="USD"
      fallback={fallback}
      format={{ maximumFractionDigits: 0 }}
    />
  )
}

function renderUsdHeadline(range: DetailFinancialRange | null | undefined) {
  if (!range) {
    return 'Unavailable'
  }

  const preferredValue = range.mid ?? range.high ?? range.low
  return renderUsd(preferredValue, { compact: true })
}

function renderUsdRange(range: DetailFinancialRange | null | undefined) {
  if (!range) {
    return 'Unavailable'
  }

  if (range.low == null && range.mid == null && range.high == null) {
    return 'Unavailable'
  }

  if (range.low != null && range.high != null) {
    return (
      <>
        {renderUsd(range.low)} - {renderUsd(range.high)}
      </>
    )
  }

  return renderUsd(range.mid)
}

function getDeltaTone(value: string | null | undefined) {
  if (!value || value === 'Unavailable') {
    return 'neutral' as const
  }

  const normalized = value.trim()

  if (normalized.startsWith('+')) {
    return 'positive' as const
  }

  if (normalized.startsWith('-')) {
    return 'negative' as const
  }

  return 'neutral' as const
}

function trimDeltaPrefix(value: string) {
  return value.trim().replace(/^[+-]/, '')
}

function DeltaBadge({
  value,
  compact = false,
}: {
  value: string | null | undefined
  compact?: boolean
}) {
  if (!value || value === 'Unavailable') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: TOKENS.colors.neutral2,
          fontSize: compact ? TOKENS.typography.body3.size : TOKENS.typography.body2.size,
          lineHeight: compact
            ? TOKENS.typography.body3.lineHeight
            : TOKENS.typography.body2.lineHeight,
          fontWeight: 500,
        }}
      >
        Unavailable
      </span>
    )
  }

  const tone = getDeltaTone(value)
  const color =
    tone === 'positive'
      ? TOKENS.colors.success
      : tone === 'negative'
        ? TOKENS.colors.critical
        : TOKENS.colors.neutral2

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? '6px' : '8px',
        color,
        fontSize: compact ? TOKENS.typography.body3.size : TOKENS.typography.body2.size,
        lineHeight: compact
          ? TOKENS.typography.body3.lineHeight
          : TOKENS.typography.body2.lineHeight,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {tone !== 'neutral' ? (
        <svg
          width={compact ? '10' : '12'}
          height={compact ? '10' : '12'}
          viewBox="0 0 12 12"
          aria-hidden="true"
          style={{ color, transform: tone === 'negative' ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M6 2 11 10H1L6 2Z" fill="currentColor" />
        </svg>
      ) : null}
      <span>{trimDeltaPrefix(value)}</span>
    </span>
  )
}

function SplitStatBar({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  leftShare,
  stacked = false,
}: {
  leftLabel: string
  leftValue: ReactNode
  rightLabel: string
  rightValue: ReactNode
  leftShare: number
  stacked?: boolean
}) {
  const normalizedLeftShare =
    Number.isFinite(leftShare) && leftShare > 0 && leftShare < 1 ? leftShare : leftShare >= 1 ? 1 : 0
  const compactLayout = useContext(GamePageCompactContext)
  const shouldStack = stacked || compactLayout

  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: shouldStack ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: TOKENS.spacing.md,
        }}
      >
        <div style={{ display: 'grid', gap: '2px' }}>
          <span
            style={{
              color: TOKENS.colors.neutral1,
              fontSize: TOKENS.typography.heading2.size,
              lineHeight: TOKENS.typography.heading2.lineHeight,
              fontWeight: 500,
            }}
          >
            {leftValue}
          </span>
          <span
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body3.size,
              lineHeight: TOKENS.typography.body3.lineHeight,
            }}
          >
            {leftLabel}
          </span>
        </div>
        <div style={{ display: 'grid', gap: '2px', justifyItems: 'end', textAlign: 'right' }}>
          <span
            style={{
              color: TOKENS.colors.neutral1,
              fontSize: TOKENS.typography.heading2.size,
              lineHeight: TOKENS.typography.heading2.lineHeight,
              fontWeight: 500,
            }}
          >
            {rightValue}
          </span>
          <span
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body3.size,
              lineHeight: TOKENS.typography.body3.lineHeight,
            }}
          >
            {rightLabel}
          </span>
        </div>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          width: '100%',
          height: '14px',
          borderRadius: TOKENS.radii.pill,
          alignItems: 'center',
          gap: '3px',
        }}
      >
        <div
          style={{
            width: `${normalizedLeftShare * 100}%`,
            minWidth: normalizedLeftShare > 0 ? '10px' : 0,
            height: '100%',
            borderRadius: `${TOKENS.radii.pill} 10px 10px ${TOKENS.radii.pill}`,
            background: TOKENS.colors.success,
          }}
        />
        <div
          style={{
            width: `${(1 - normalizedLeftShare) * 100}%`,
            minWidth: normalizedLeftShare < 1 ? '10px' : 0,
            height: '100%',
            borderRadius: `10px ${TOKENS.radii.pill} ${TOKENS.radii.pill} 10px`,
            background: TOKENS.colors.critical,
          }}
        />
      </div>
    </div>
  )
}

function PairedMetricBox({
  items,
  stacked = false,
}: {
  items: Array<{ label: string; value: ReactNode }>
  stacked?: boolean
}) {
  const compactLayout = useContext(GamePageCompactContext)
  const shouldStack = stacked || compactLayout

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: shouldStack ? '1fr' : 'repeat(2, minmax(0, 1fr))',
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          style={{
            display: 'grid',
            gap: TOKENS.spacing.xs,
            padding: TOKENS.spacing.lg,
            borderLeft:
              !shouldStack && index % 2 === 1 ? `1px solid ${TOKENS.colors.surface3}` : 'none',
            borderTop:
              shouldStack
                ? index > 0
                  ? `1px solid ${TOKENS.colors.surface3}`
                  : 'none'
                : index > 1
                  ? `1px solid ${TOKENS.colors.surface3}`
                  : 'none',
          }}
        >
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.heading3.size,
              lineHeight: TOKENS.typography.heading3.lineHeight,
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              color: TOKENS.colors.neutral1,
              fontSize: TOKENS.typography.heading2.size,
              lineHeight: TOKENS.typography.heading2.lineHeight,
              fontWeight: TOKENS.typography.heading2.weight,
              letterSpacing: TOKENS.typography.heading2.letterSpacing,
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function FeatureMetric({
  label,
  value,
  delta,
}: {
  label: string
  value: ReactNode
  delta?: string | null
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: TOKENS.spacing.xs,
      }}
    >
      <div
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.heading3.size,
          lineHeight: TOKENS.typography.heading3.lineHeight,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: TOKENS.spacing.sm,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            color: TOKENS.colors.neutral1,
            fontSize: TOKENS.typography.heading1.size,
            lineHeight: TOKENS.typography.heading1.lineHeight,
            fontWeight: TOKENS.typography.heading1.weight,
            letterSpacing: TOKENS.typography.heading1.letterSpacing,
          }}
        >
          {value}
        </span>
        {delta ? <DeltaBadge value={delta} /> : null}
      </div>
    </div>
  )
}

function SectionNote({ note }: { note: string | null }) {
  if (!note) {
    return null
  }

  return (
    <div
      style={{
        color: TOKENS.colors.neutral2,
        fontSize: TOKENS.typography.body3.size,
        lineHeight: TOKENS.typography.body3.lineHeight,
      }}
    >
      {note}
    </div>
  )
}

function formatAvailability(status: 'available' | 'partial' | 'unavailable') {
  if (status === 'available') return 'Live'
  if (status === 'partial') return 'Partial'
  return 'Unavailable'
}

function formatEstimateCompact(value: number | null | undefined) {
  return renderCompactNumber(value)
}

function formatRobux(value: number | null | undefined, freeLabel = 'Free') {
  return renderRobux(value, freeLabel)
}

function formatPercent(value: number | null | undefined) {
  return renderPercent(value)
}

function formatSignedPercentValue(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return 'Unavailable'
  }

  return formatSignedPercent(value)
}

function formatUsdRange(range: DetailFinancialRange | null | undefined) {
  return renderUsdRange(range)
}

function formatConfidence(value: 'high' | 'medium' | 'low' | undefined) {
  if (!value) {
    return 'Unavailable'
  }

  return value[0].toUpperCase() + value.slice(1)
}

function InventoryPreview({
  title,
  items,
}: {
  title: string
  items: DetailInventoryItem[]
}) {
  const compactLayout = useContext(GamePageCompactContext)

  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
      <div
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body3.size,
          lineHeight: TOKENS.typography.body3.lineHeight,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {title}
      </div>
      {items.length === 0 ? (
        <div
          style={{
            color: TOKENS.colors.neutral2,
            fontSize: TOKENS.typography.body3.size,
            lineHeight: TOKENS.typography.body3.lineHeight,
          }}
        >
          No items returned.
        </div>
      ) : (
        items.slice(0, 6).map((item, index) => (
          <div
            key={`${item.id ?? index}-${item.name}`}
            style={{
              display: 'flex',
              flexDirection: compactLayout ? 'column' : 'row',
              alignItems: compactLayout ? 'flex-start' : 'center',
              justifyContent: 'space-between',
              gap: TOKENS.spacing.md,
            }}
          >
            <span
              style={{
                color: TOKENS.colors.neutral1,
                fontSize: TOKENS.typography.body2.size,
                lineHeight: TOKENS.typography.body2.lineHeight,
                minWidth: 0,
              }}
            >
              {item.name}
            </span>
            <span
              style={{
                color: TOKENS.colors.neutral2,
                fontSize: TOKENS.typography.body3.size,
                lineHeight: TOKENS.typography.body3.lineHeight,
                whiteSpace: compactLayout ? 'normal' : 'nowrap',
              }}
            >
              {item.price == null ? 'No price' : renderRobux(item.price)}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function PortfolioPreview({ games }: { games: DetailPortfolioGame[] }) {
  if (games.length === 0) {
    return (
      <div
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body3.size,
          lineHeight: TOKENS.typography.body3.lineHeight,
        }}
      >
        No additional public games returned.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
      {games.map((entry) => (
        <div
          key={entry.universeId}
          style={{
            display: 'grid',
            gap: TOKENS.spacing.xxs,
            paddingBottom: TOKENS.spacing.sm,
            borderBottom: `1px solid ${TOKENS.colors.surface3}`,
          }}
        >
          <div
            style={{
              color: TOKENS.colors.neutral1,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
              fontWeight: 500,
            }}
          >
            {entry.name}
          </div>
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body3.size,
              lineHeight: TOKENS.typography.body3.lineHeight,
            }}
          >
            {entry.genre} ·{' '}
            {entry.playing == null
              ? renderCompactNumber(entry.visits ?? 0)
              : <><WholeNumber value={entry.playing} /> live</>}
          </div>
        </div>
      ))}
    </div>
  )
}

function ComparablePreview({ games }: { games: DetailComparableGame[] }) {
  const compactLayout = useContext(GamePageCompactContext)

  if (games.length === 0) {
    return (
      <div
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body3.size,
          lineHeight: TOKENS.typography.body3.lineHeight,
        }}
      >
        No comparable games returned.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
      {games.map((entry) => (
        <div
          key={entry.universeId}
          style={{
            display: 'grid',
            gap: TOKENS.spacing.xxs,
            paddingBottom: TOKENS.spacing.sm,
            borderBottom: `1px solid ${TOKENS.colors.surface3}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: compactLayout ? 'column' : 'row',
              alignItems: compactLayout ? 'flex-start' : 'baseline',
              justifyContent: 'space-between',
              gap: TOKENS.spacing.md,
            }}
          >
            <div
              style={{
                color: TOKENS.colors.neutral1,
                fontSize: TOKENS.typography.body2.size,
                lineHeight: TOKENS.typography.body2.lineHeight,
                fontWeight: 500,
                minWidth: 0,
              }}
            >
              {entry.name}
            </div>
            <div
              style={{
                color: TOKENS.colors.neutral2,
                fontSize: TOKENS.typography.body3.size,
                lineHeight: TOKENS.typography.body3.lineHeight,
                whiteSpace: compactLayout ? 'normal' : 'nowrap',
              }}
            >
              Score <AnimatedNumber value={entry.similarityScore} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
            </div>
          </div>
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body3.size,
              lineHeight: TOKENS.typography.body3.lineHeight,
            }}
          >
            {entry.genre} · <WholeNumber value={entry.playing} /> live · <ApprovalNumber value={entry.approval} suffix="% liked" />
          </div>
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body3.size,
              lineHeight: TOKENS.typography.body3.lineHeight,
            }}
          >
            Estimated monthly revenue {renderUsdRange(entry.estimatedMonthlyRevenueUsd)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function GamePage({
  gameDetail,
  isLoading,
  error,
  chartRange,
  availableRanges,
  onChangeRange,
  onOpenHeatPage,
}: GamePageProps) {
  const [isPreparingShare, setIsPreparingShare] = useState(false)
  const [selectedShareVariant, setSelectedShareVariant] =
    useState<(typeof SHARE_VARIANT_OPTIONS)[number]['id']>('poster')
  const [selectedShareBackground, setSelectedShareBackground] = useState<string>(
    SHARE_BACKGROUND_OPTIONS[0].url,
  )
  const [sharePreviewEnabled, setSharePreviewEnabled] = useState(false)
  const [inlineSharePreviewUrl, setInlineSharePreviewUrl] = useState<string | null>(null)
  const [sharePreviewUrl, setSharePreviewUrl] = useState<string | null>(null)
  const [sharePreviewFile, setSharePreviewFile] = useState<File | null>(null)
  const viewportWidth = useViewportWidth()
  const isMobile = viewportWidth > 0 && viewportWidth <= 640

  useEffect(() => {
    return () => {
      if (sharePreviewUrl) {
        URL.revokeObjectURL(sharePreviewUrl)
      }
    }
  }, [sharePreviewUrl])

  useEffect(() => {
    setSharePreviewEnabled(false)

    if (!gameDetail?.game.universeId) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSharePreviewEnabled(true)
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [gameDetail?.game.universeId])

  const seedLineData = toLiveLineData(gameDetail?.timeline ?? [])
  const isLiveRange = chartRange === '30m' || chartRange === '1h'
  const { data: liveBoard } = useLiveBoard('24h', sharePreviewEnabled)
  const liveLine = useRollingLiveline({
    initialData: seedLineData,
    windowSeconds: CHART_RANGE_SECONDS[chartRange],
    reseedKey: `${gameDetail?.game.universeId ?? 'none'}:${chartRange}`,
    enabled: isLiveRange && (gameDetail?.game.universeId ?? 0) > 0,
    pollIntervalMs: 5_000,
    heartbeatMs: 250,
    fetchLatest:
      isLiveRange && gameDetail?.game.universeId != null
        ? () => fetchGameLivePoint(gameDetail.game.universeId)
        : undefined,
  })
  const observedCoverageSeconds = getCoverageSeconds(liveLine.data)
  const chartWindowSeconds = isLiveRange
    ? CHART_RANGE_SECONDS[chartRange]
    : observedCoverageSeconds > 0
      ? Math.min(CHART_RANGE_SECONDS[chartRange], observedCoverageSeconds + 300)
      : CHART_RANGE_SECONDS[chartRange]
  const liveCoverageSeconds =
    observedCoverageSeconds
  const liveCoverageNote =
    liveCoverageSeconds > 0 &&
    liveCoverageSeconds < CHART_RANGE_SECONDS[chartRange] * 0.75
      ? `Showing ${formatDurationCompact(liveCoverageSeconds)} of tracked samples in the ${chartRange} window.`
      : undefined
  const shareCardGame = gameDetail?.game
  const shareCardLiveCcu = liveLine.latestValue ?? shareCardGame?.playing ?? 0
  const shareCardThumbnailUrl = shareCardGame?.universeId
    ? `/api/game-icon/${shareCardGame.universeId}`
    : shareCardGame?.thumbnailUrl
  const shareCardRankIndex =
    shareCardGame == null
      ? -1
      : (liveBoard?.leaderboard.findIndex((entry) => entry.universeId === shareCardGame.universeId) ?? -1)
  const shareCardRankLabel = shareCardRankIndex >= 0 ? `#${shareCardRankIndex + 1}` : 'N/A'

  const buildShareCardBlob = () => {
    if (!shareCardGame) {
      throw new Error('Game data is unavailable.')
    }

    return generateGameShareCard({
      gameName: shareCardGame.name,
      creatorName: shareCardGame.creatorName,
      liveCcu: shareCardLiveCcu,
      approval: shareCardGame.approval,
      rankLabel: shareCardRankLabel,
      thumbnailUrl: shareCardThumbnailUrl,
      backgroundImageUrl: selectedShareBackground,
      variant: selectedShareVariant,
    })
  }

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
          return
        }

        reject(new Error('Unable to build share preview URL.'))
      }
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read share preview blob.'))
      reader.readAsDataURL(blob)
    })

  useEffect(() => {
    let cancelled = false

    if (!sharePreviewEnabled || !shareCardGame) {
      setInlineSharePreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current)
        }

        return null
      })
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const blob = await generateGameShareCard({
          gameName: shareCardGame.name,
          creatorName: shareCardGame.creatorName,
          liveCcu: shareCardLiveCcu,
          approval: shareCardGame.approval,
          rankLabel: shareCardRankLabel,
          thumbnailUrl: shareCardThumbnailUrl,
          backgroundImageUrl: selectedShareBackground,
          variant: selectedShareVariant,
        })
        const previewUrl = await blobToDataUrl(blob)

        if (cancelled) {
          return
        }

        setInlineSharePreviewUrl(previewUrl)
      } catch {
        if (!cancelled) {
          setInlineSharePreviewUrl(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    sharePreviewEnabled,
    shareCardGame,
    shareCardGame?.name,
    shareCardGame?.creatorName,
    shareCardGame?.approval,
    shareCardGame?.thumbnailUrl,
    shareCardGame?.universeId,
    shareCardLiveCcu,
    shareCardRankLabel,
    shareCardThumbnailUrl,
    selectedShareBackground,
    selectedShareVariant,
  ])

  if (isLoading) {
    return (
      <GamePageCompactContext.Provider value={isMobile}>
        <div
          style={{
            minHeight: '100vh',
            background: TOKENS.colors.surface1,
            color: TOKENS.colors.neutral1,
            fontFamily: TOKENS.typography.fontFamily,
          }}
        >
          <main
            style={{
              maxWidth: '1100px',
              margin: '0 auto',
              padding: '32px 28px 72px',
              display: 'grid',
              gap: TOKENS.spacing.xxl,
            }}
          >
          <section
            style={{
              display: 'grid',
              gap: TOKENS.spacing.xl,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: isMobile ? 'flex-start' : 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: TOKENS.spacing.lg,
                paddingBottom: TOKENS.spacing.xl,
                borderBottom: `1px solid ${TOKENS.colors.surface3}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: TOKENS.spacing.md,
                  minWidth: 0,
                  flex: '1 1 420px',
                }}
              >
                <Skeleton width="72px" height="72px" radius="18px" />
                <div style={{ display: 'grid', gap: '6px', minWidth: 0 }}>
                  <Skeleton width="min(320px, 62vw)" height="32px" radius={TOKENS.radii.md} />
                  <Skeleton width="min(190px, 48vw)" height="20px" radius={TOKENS.radii.sm} />
                </div>
              </div>
            </div>

            <section className="market-game-layout">
              <div style={{ display: 'grid', gap: TOKENS.spacing.lg }}>
                <LiveMetricHero
                  label="Live CCU"
                  value="0"
                  points={[]}
                  loading
                  headerTrailing={
                    <SegmentedControl
                      options={availableRanges}
                      value={chartRange}
                      onChange={onChangeRange}
                    />
                  }
                  chartHeight={320}
                  chart={
                    <LiveLineChart
                      data={[]}
                      tone="positive"
                      color={TOKENS.colors.base}
                      height={320}
                      window={chartWindowSeconds}
                      loading
                    />
                  }
                />
                <PairedMetricBoxSkeleton stacked={isMobile} />
              </div>

              <div style={{ display: 'grid', gap: TOKENS.spacing.lg }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                    gap: TOKENS.spacing.md,
                  }}
                >
                  <Skeleton width="100%" height="45px" radius={TOKENS.radii.lg} />
                  <Skeleton width="100%" height="45px" radius={TOKENS.radii.lg} />
                </div>
                <EstimatedValueSkeleton />
                <StatsPanelSkeleton stacked={isMobile} />
              </div>
            </section>
          </section>

          <section
            style={{
              display: 'grid',
              gap: TOKENS.spacing.xs,
              paddingTop: TOKENS.spacing.md,
              borderTop: `1px solid ${TOKENS.colors.surface3}`,
            }}
          >
            <Skeleton width="132px" height="24px" radius={TOKENS.radii.md} />
            <Skeleton width="min(460px, 100%)" height="18px" radius={TOKENS.radii.sm} />
          </section>

          <section
            style={{
              display: 'grid',
              gap: TOKENS.spacing.lg,
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            }}
          >
            <RawDataCardSkeleton rows={6} />
            <RawDataCardSkeleton rows={6} />
            <RawDataCardSkeleton rows={4} note />
            <RawDataCardSkeleton rows={6} note />
            <RawDataCardSkeleton rows={5} note />
            <RawDataCardSkeleton rows={5} note />
          </section>
          </main>
        </div>
      </GamePageCompactContext.Provider>
    )
  }

  if (error || !gameDetail) {
    return (
      <GamePageCompactContext.Provider value={isMobile}>
        <div
          style={{
            minHeight: '100vh',
            background: TOKENS.colors.surface1,
            color: TOKENS.colors.neutral1,
            fontFamily: TOKENS.typography.fontFamily,
          }}
        >
          <main
            style={{
              maxWidth: '1100px',
              margin: '0 auto',
              padding: '32px 28px 72px',
              display: 'grid',
              gap: TOKENS.spacing.lg,
            }}
          >
            <SurfacePanel title="Unable to load game">
              <div
                style={{
                  color: TOKENS.colors.neutral2,
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                }}
              >
                {error ?? 'Unknown error'}
              </div>
            </SurfacePanel>
          </main>
        </div>
      </GamePageCompactContext.Provider>
    )
  }

  const { game, timeline, stats, status } = gameDetail
  const unavailableSection = {
    status: 'unavailable' as const,
    source: 'backend payload',
    note: 'This data has not been returned by the current server payload yet.',
  }
  const dataSections = {
    pageMeta: gameDetail.dataSections?.pageMeta ?? unavailableSection,
    ageRating: gameDetail.dataSections?.ageRating ?? {
      ...unavailableSection,
      label: null,
      minimumAge: null,
      displayName: null,
      descriptors: [],
    },
    financials: gameDetail.dataSections?.financials ?? {
      ...unavailableSection,
      confidence: 'low' as const,
      estimatedRevenuePerVisit: { low: null, mid: null, high: null },
      estimatedDailyRevenueUsd: { low: null, mid: null, high: null },
      estimatedMonthlyRevenueUsd: { low: null, mid: null, high: null },
      estimatedAnnualRunRateUsd: { low: null, mid: null, high: null },
      estimatedValuationUsd: { low: null, mid: null, high: null },
      methodology: [],
    },
    growth: gameDetail.dataSections?.growth ?? {
      ...unavailableSection,
      observedHistoryHours: 0,
      growth7d: { ccu: null, visits: null, revenue: null },
      growth30d: { ccu: null, visits: null, revenue: null },
      growth90d: { ccu: null, visits: null, revenue: null },
      classification: 'Unclassified',
      daysSinceLastUpdate: 0,
      genreAverageGrowth30d: null,
    },
    players: gameDetail.dataSections?.players ?? {
      ...unavailableSection,
      currentCCU: game.playing,
      estimatedDAU: null,
      estimatedMAU: null,
      peakCCUObserved: null,
      peakCCU30dObserved: null,
      averageSessionLengthMinutes: null,
      dailyVisitsObserved: null,
      hourlyHeatmap: [],
    },
    monetization: gameDetail.dataSections?.monetization ?? {
      ...unavailableSection,
      hasPremiumPayoutsLikely: null,
      strategy: 'Unavailable',
      gamePassCount: 0,
      developerProductCount: 0,
      totalMonetizationItemCount: 0,
      averageGamePassPrice: null,
      averageDeveloperProductPrice: null,
      gamePassCountVsGenreAverage: null,
      averageGamePassPriceVsGenreAverage: null,
    },
    comparables: gameDetail.dataSections?.comparables ?? {
      ...unavailableSection,
      games: [],
    },
    developerSummary: gameDetail.dataSections?.developerSummary ?? {
      ...unavailableSection,
      estimatedPortfolioMonthlyRevenueUsd: { low: null, mid: null, high: null },
      trackRecordScore: null,
    },
    creatorProfile: gameDetail.dataSections?.creatorProfile ?? unavailableSection,
    creatorPortfolio: gameDetail.dataSections?.creatorPortfolio ?? {
      ...unavailableSection,
      totalCount: 0,
      games: [],
    },
    servers: gameDetail.dataSections?.servers ?? {
      ...unavailableSection,
      servers: [],
    },
    socialDiscovery: gameDetail.dataSections?.socialDiscovery ?? {
      ...unavailableSection,
      youtube: null,
      tiktok: null,
      x: null,
      robloxSearchTrend: null,
    },
    store: gameDetail.dataSections?.store ?? {
      gamePasses: {
        ...unavailableSection,
        totalCount: 0,
        items: [],
      },
      developerProducts: {
        ...unavailableSection,
        totalCount: 0,
        items: [],
      },
    },
  }
  const normalizedGame = {
    ...game,
    rootPlaceId: game.rootPlaceId ?? null,
    description: game.description ?? '',
    creatorId: game.creatorId ?? null,
    creatorHasVerifiedBadge: game.creatorHasVerifiedBadge ?? false,
    rblxScore: game.rblxScore ?? null,
    genrePrimary: game.genrePrimary ?? game.genre,
    genreSecondary: game.genreSecondary ?? null,
    upVotes: game.upVotes ?? 0,
    downVotes: game.downVotes ?? 0,
    price: game.price ?? null,
    maxPlayers: game.maxPlayers ?? null,
    created: game.created ?? null,
    createVipServersAllowed: game.createVipServersAllowed ?? false,
    screenshotUrls: game.screenshotUrls ?? [],
  }
  const screenshotUrls = normalizedGame.screenshotUrls.slice(0, 3)
  const livePlaying = liveLine.latestValue ?? game.playing
  const statsByLabel = new Map(stats.map((stat) => [stat.label, stat.value]))
  const move6h = statsByLabel.get('6h move')
  const favorites24h = statsByLabel.get('Favorites 24h')
  const robloxGameUrl =
    normalizedGame.rootPlaceId != null
      ? `https://www.roblox.com/games/${normalizedGame.rootPlaceId}`
      : null
  const voteTotal = normalizedGame.upVotes + normalizedGame.downVotes
  const upvoteShare = voteTotal > 0 ? normalizedGame.upVotes / voteTotal : 0.5
  const shareFileName = `${game.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'roterminal-game'}.png`
  const supportingMetrics = [
    {
      label: 'Approval',
      value: <ApprovalNumber value={game.approval} />,
      delta: move6h,
    },
    {
      label: 'Visits',
      value: <CompactNumber value={game.visits} />,
      delta: formatSignedPercentValue(dataSections.growth.growth30d.visits),
    },
    {
      label:
        dataSections.financials.estimatedMonthlyRevenueUsd.mid != null ||
        dataSections.financials.estimatedMonthlyRevenueUsd.low != null ||
        dataSections.financials.estimatedMonthlyRevenueUsd.high != null
          ? 'Monthly revenue'
          : 'Favorites',
      value:
        dataSections.financials.estimatedMonthlyRevenueUsd.mid != null ||
        dataSections.financials.estimatedMonthlyRevenueUsd.low != null ||
        dataSections.financials.estimatedMonthlyRevenueUsd.high != null
          ? renderUsdHeadline(dataSections.financials.estimatedMonthlyRevenueUsd)
          : <CompactNumber value={game.favoritedCount} />,
      delta:
        dataSections.financials.estimatedMonthlyRevenueUsd.mid != null ||
        dataSections.financials.estimatedMonthlyRevenueUsd.low != null ||
        dataSections.financials.estimatedMonthlyRevenueUsd.high != null
          ? formatSignedPercentValue(dataSections.growth.growth30d.revenue)
          : favorites24h,
    },
  ]

  const openSharePreview = async () => {
    setSharePreviewEnabled(true)
    setIsPreparingShare(true)

    try {
      const blob = await buildShareCardBlob()
      const file = new File([blob], shareFileName, { type: 'image/png' })
      const objectUrl = URL.createObjectURL(blob)

      setSharePreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current)
        }

        return objectUrl
      })
      setSharePreviewFile(file)
    } finally {
      setIsPreparingShare(false)
    }
  }

  const closeSharePreview = () => {
    setSharePreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current)
      }

      return null
    })
    setSharePreviewFile(null)
  }

  const handleSharePreview = async () => {
    if (!sharePreviewFile) {
      return
    }

    const shareUrl = window.location.href
    const canShareFiles =
      typeof navigator !== 'undefined' &&
      'canShare' in navigator &&
      navigator.canShare?.({ files: [sharePreviewFile] })

    if (navigator.share && canShareFiles) {
      await navigator.share({
        title: game.name,
        text: `${game.name} on RoTerminal`,
        files: [sharePreviewFile],
      })
      return
    }

    const fallbackUrl = sharePreviewUrl ?? URL.createObjectURL(sharePreviewFile)
    const anchor = document.createElement('a')
    anchor.href = fallbackUrl
    anchor.download = sharePreviewFile.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    if (!sharePreviewUrl) {
      URL.revokeObjectURL(fallbackUrl)
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl)
    }
  }
  return (
    <GamePageCompactContext.Provider value={isMobile}>
      <div
        style={{
          minHeight: '100vh',
          background: TOKENS.colors.surface1,
          color: TOKENS.colors.neutral1,
          fontFamily: TOKENS.typography.fontFamily,
        }}
      >
        <main
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            padding: '32px 28px 72px',
            display: 'grid',
            gap: TOKENS.spacing.xxl,
          }}
        >
        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.xl,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: isMobile ? 'flex-start' : 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: TOKENS.spacing.lg,
              paddingBottom: TOKENS.spacing.xl,
              borderBottom: `1px solid ${TOKENS.colors.surface3}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: TOKENS.spacing.md,
                minWidth: 0,
                flex: '1 1 420px',
              }}
            >
              <GameImageIcon
                label={game.name}
                size={72}
                imageUrl={game.thumbnailUrl}
                universeId={game.universeId}
                style={{
                  flexShrink: 0,
                }}
              />

              <div style={{ display: 'grid', gap: '2px', minWidth: 0 }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: TOKENS.typography.heading1.size,
                    lineHeight: TOKENS.typography.heading1.lineHeight,
                    fontWeight: TOKENS.typography.heading1.weight,
                    letterSpacing: TOKENS.typography.heading1.letterSpacing,
                  }}
                >
                  {game.name}
                </h1>
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body1.size,
                    lineHeight: TOKENS.typography.body1.lineHeight,
                  }}
                >
                  {game.creatorName}
                  {normalizedGame.creatorHasVerifiedBadge ? (
                    <>
                      {' '}
                      <VerifiedBadge />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <section className="market-game-layout">
            <div style={{ display: 'grid', gap: TOKENS.spacing.lg }}>
              <LiveMetricHero
                label="Live CCU"
                value={<CompactNumber value={livePlaying} />}
                subtitle={liveCoverageNote}
                valueStyle={{
                  fontSize: TOKENS.typography.heading1.size,
                  lineHeight: TOKENS.typography.heading1.lineHeight,
                  fontWeight: TOKENS.typography.heading1.weight,
                  letterSpacing: TOKENS.typography.heading1.letterSpacing,
                }}
                headerTrailing={
                  <SegmentedControl
                    options={availableRanges}
                    value={chartRange}
                    onChange={onChangeRange}
                  />
                }
                points={timeline.map((point) => point.value)}
                tone={status.tone}
                chartHeight={320}
                chart={
                  <LiveLineChart
                    data={liveLine.data}
                    window={chartWindowSeconds}
                    tone={status.tone}
                    color={TOKENS.colors.base}
                    height={320}
                    loading={liveLine.data.length === 0}
                  />
                }
              />
              <div
                style={{
                  borderRadius: TOKENS.radii.xxl,
                  border: `1px solid ${TOKENS.colors.surface3}`,
                  overflow: 'hidden',
                  background: TOKENS.colors.surface1,
                }}
              >
                <PairedMetricBox
                  items={[
                    {
                      label: 'Estimated DAU',
                      value: formatEstimateCompact(dataSections.players.estimatedDAU),
                    },
                    {
                      label: 'Estimated MAU',
                      value: formatEstimateCompact(dataSections.players.estimatedMAU),
                    },
                    {
                      label: 'Daily visits',
                      value: formatEstimateCompact(dataSections.players.dailyVisitsObserved),
                    },
                    {
                      label: 'Avg session length',
                      value:
                        dataSections.players.averageSessionLengthMinutes == null
                          ? 'Unavailable'
                          : <><WholeNumber value={dataSections.players.averageSessionLengthMinutes} /> min</>,
                    },
                  ]}
                  stacked={isMobile}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gap: TOKENS.spacing.lg }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: TOKENS.spacing.md,
                }}
              >
                <MarketButton
                  type="button"
                  variant="secondary"
                  style={{ width: '100%' }}
                  disabled={isPreparingShare}
                  onClick={openSharePreview}
                >
                  {isPreparingShare ? 'Preparing…' : 'Share'}
                </MarketButton>
                <MarketButton
                  type="button"
                  variant="secondary"
                  style={{ width: '100%' }}
                  onClick={onOpenHeatPage}
                >
                  Heatpage
                </MarketButton>
                <MarketButton
                  type="button"
                  variant="secondary"
                  style={{ width: '100%' }}
                  leadingIcon={<ExternalLink size={20} strokeWidth={2.4} />}
                  disabled={!robloxGameUrl}
                  onClick={() => {
                    if (!robloxGameUrl) {
                      return
                    }

                    window.open(robloxGameUrl, '_blank', 'noopener,noreferrer')
                  }}
                >
                  Visit
                </MarketButton>
              </div>

              <SurfacePanel style={{ gap: TOKENS.spacing.lg, border: 'none' }}>
                <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
                  <div
                    style={{
                      color: TOKENS.colors.neutral2,
                      fontSize: TOKENS.typography.heading3.size,
                      lineHeight: TOKENS.typography.heading3.lineHeight,
                    }}
                  >
                    Estimated value
                  </div>
                  <div
                    style={{
                      color: TOKENS.colors.neutral1,
                      fontSize: TOKENS.typography.heading1.size,
                      lineHeight: TOKENS.typography.heading1.lineHeight,
                      fontWeight: TOKENS.typography.heading1.weight,
                      letterSpacing: TOKENS.typography.heading1.letterSpacing,
                    }}
                  >
                    {renderUsdHeadline(dataSections.financials.estimatedValuationUsd)}
                  </div>
                  <div
                    style={{
                      color: TOKENS.colors.neutral2,
                      fontSize: TOKENS.typography.body2.size,
                      lineHeight: TOKENS.typography.body2.lineHeight,
                    }}
                  >
                    {dataSections.financials.note ?? 'Estimated from current revenue and growth signals.'}
                  </div>
                </div>
              </SurfacePanel>

              <SurfacePanel title="Share preview" style={{ gap: TOKENS.spacing.md, border: 'none' }}>
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: TOKENS.radii.xxl,
                    border: `1px solid ${TOKENS.colors.surface3}`,
                    background: TOKENS.colors.surface1,
                    padding: TOKENS.spacing.sm,
                    minHeight: '280px',
                  }}
                >
                  {inlineSharePreviewUrl ? (
                    <img
                      src={inlineSharePreviewUrl}
                      alt={`${game.name} share card preview`}
                      style={{
                        display: 'block',
                        width: '100%',
                        maxWidth: '420px',
                        height: 'auto',
                        borderRadius: TOKENS.radii.xxl,
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <Skeleton width="100%" height="280px" radius={TOKENS.radii.xxl} />
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: TOKENS.spacing.sm,
                    flexWrap: 'wrap',
                  }}
                >
                  {SHARE_VARIANT_OPTIONS.map((option) => {
                    const selected = option.id === selectedShareVariant

                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-label={`Use ${option.label} share layout`}
                        aria-pressed={selected}
                        onClick={() => setSelectedShareVariant(option.id)}
                        style={{
                          borderRadius: TOKENS.radii.pill,
                          border: selected
                            ? `1px solid ${TOKENS.colors.neutral1}`
                            : `1px solid ${TOKENS.colors.surface3}`,
                          background: selected ? TOKENS.colors.surface2 : TOKENS.colors.surface1,
                          color: TOKENS.colors.neutral1,
                          fontSize: TOKENS.typography.body2.size,
                          lineHeight: TOKENS.typography.body2.lineHeight,
                          padding: `${TOKENS.spacing.xs} ${TOKENS.spacing.md}`,
                          cursor: 'pointer',
                        }}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                {selectedShareVariant === 'split' ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: TOKENS.spacing.sm,
                      flexWrap: 'wrap',
                    }}
                  >
                  {SHARE_BACKGROUND_OPTIONS.map((option) => {
                    const selected = option.url === selectedShareBackground

                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-label={`Use ${option.label} share background`}
                        aria-pressed={selected}
                        onClick={() => setSelectedShareBackground(option.url)}
                        style={{
                          width: '72px',
                          height: '48px',
                          borderRadius: TOKENS.radii.lg,
                          border: selected
                            ? `2px solid ${TOKENS.colors.neutral1}`
                            : `1px solid ${TOKENS.colors.surface3}`,
                          backgroundImage: `url(${option.url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          boxShadow: selected ? '0 0 0 3px rgba(255,255,255,0.12)' : 'none',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      />
                    )
                  })}
                  </div>
                ) : null}
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body2.size,
                    lineHeight: TOKENS.typography.body2.lineHeight,
                  }}
                >
                  Live in-page preview of the share asset so we can iterate on the design quickly.
                </div>
              </SurfacePanel>

              <SurfacePanel title="Stats" style={{ gap: TOKENS.spacing.lg, border: 'none' }}>
                <div style={{ display: 'grid', gap: TOKENS.spacing.xl }}>
                  <SplitStatBar
                    leftLabel="Likes"
                    leftValue={<CompactNumber value={normalizedGame.upVotes} />}
                    rightLabel="Dislikes"
                    rightValue={<CompactNumber value={normalizedGame.downVotes} />}
                    leftShare={upvoteShare}
                    stacked={isMobile}
                  />

                  <div style={{ display: 'grid', gap: TOKENS.spacing.xl }}>
                    {supportingMetrics.map((metric) => (
                      <FeatureMetric
                        key={metric.label}
                        label={metric.label}
                        value={metric.value}
                        delta={metric.delta}
                      />
                    ))}
                  </div>
                </div>
              </SurfacePanel>
            </div>
          </section>
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.xs,
            paddingTop: TOKENS.spacing.md,
            borderTop: `1px solid ${TOKENS.colors.surface3}`,
          }}
        >
          <div
            style={{
              color: TOKENS.colors.neutral1,
              fontSize: TOKENS.typography.heading3.size,
              lineHeight: TOKENS.typography.heading3.lineHeight,
              fontWeight: TOKENS.typography.heading3.weight,
            }}
          >
            Raw game data
          </div>
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
            }}
          >
            Everything fetched right now is below this line. We can design and lay it out after.
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.lg,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          <SurfacePanel title="Game profile">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow label="Universe ID" value={renderWholeNumber(game.universeId)} />
              <StatRow label="Place ID" value={renderWholeNumber(normalizedGame.rootPlaceId)} />
              <StatRow
                label="RBlx Score"
                value={renderWholeNumber(normalizedGame.rblxScore)}
              />
              <StatRow label="Created" value={formatDate(normalizedGame.created)} />
              <StatRow label="Updated" value={formatDate(game.updated)} />
              <StatRow label="Genre L1" value={normalizedGame.genrePrimary} />
              <StatRow label="Genre L2" value={normalizedGame.genreSecondary ?? 'Unavailable'} />
              <StatRow label="Max players" value={renderWholeNumber(normalizedGame.maxPlayers)} />
              <StatRow label="Paid access" value={formatRobux(normalizedGame.price)} />
              <StatRow
                label="Private servers"
                value={normalizedGame.createVipServersAllowed ? 'Allowed' : 'Disabled'}
              />
            </div>
          </SurfacePanel>

          <SurfacePanel title="Votes and traffic">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow label="Live CCU" value={renderWholeNumber(game.playing)} />
              <StatRow label="Visits" value={renderCompactNumber(game.visits)} />
              <StatRow label="Favorites" value={renderCompactNumber(game.favoritedCount)} />
              <StatRow label="Upvotes" value={renderWholeNumber(normalizedGame.upVotes)} />
              <StatRow label="Downvotes" value={renderWholeNumber(normalizedGame.downVotes)} />
              <StatRow label="Like ratio" value={<ApprovalNumber value={game.approval} suffix="% liked" />} />
            </div>
          </SurfacePanel>

          <SurfacePanel title="Age rating">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.ageRating.status)}
              />
              <StatRow
                label="Label"
                value={
                  dataSections.ageRating.displayName ??
                  dataSections.ageRating.label ??
                  'Unavailable'
                }
              />
              <StatRow
                label="Minimum age"
                value={renderWholeNumber(dataSections.ageRating.minimumAge)}
              />
              <StatRow
                label="Descriptors"
                value={
                  (dataSections.ageRating.descriptors?.length ?? 0) > 0
                    ? dataSections.ageRating.descriptors!.join(', ')
                    : 'None returned'
                }
              />
            </div>
            <SectionNote note={dataSections.ageRating.note} />
          </SurfacePanel>

          <SurfacePanel title="Player estimates">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Current CCU"
                value={renderWholeNumber(dataSections.players.currentCCU)}
              />
              <StatRow
                label="Estimated DAU"
                value={renderWholeNumber(dataSections.players.estimatedDAU)}
              />
              <StatRow
                label="Estimated MAU"
                value={renderWholeNumber(dataSections.players.estimatedMAU)}
              />
              <StatRow
                label="Observed peak CCU"
                value={renderWholeNumber(dataSections.players.peakCCUObserved)}
              />
              <StatRow
                label="Observed 30d peak"
                value={renderWholeNumber(dataSections.players.peakCCU30dObserved)}
              />
              <StatRow
                label="Avg session length"
                value={
                  dataSections.players.averageSessionLengthMinutes == null
                    ? 'Unavailable'
                    : <><WholeNumber value={dataSections.players.averageSessionLengthMinutes} /> min</>
                }
              />
              <StatRow
                label="Daily visits"
                value={renderWholeNumber(dataSections.players.dailyVisitsObserved)}
              />
            </div>
            <SectionNote note={dataSections.players.note} />
          </SurfacePanel>

          <SurfacePanel title="Growth and momentum">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow label="Classification" value={dataSections.growth.classification} />
              <StatRow
                label="7d CCU growth"
                value={formatSignedPercentValue(dataSections.growth.growth7d.ccu)}
              />
              <StatRow
                label="30d CCU growth"
                value={formatSignedPercentValue(dataSections.growth.growth30d.ccu)}
              />
              <StatRow
                label="90d CCU growth"
                value={formatSignedPercentValue(dataSections.growth.growth90d.ccu)}
              />
              <StatRow
                label="30d visits growth"
                value={formatSignedPercentValue(dataSections.growth.growth30d.visits)}
              />
              <StatRow
                label="30d revenue growth"
                value={formatSignedPercentValue(dataSections.growth.growth30d.revenue)}
              />
              <StatRow
                label="Genre avg 30d"
                value={formatSignedPercentValue(dataSections.growth.genreAverageGrowth30d)}
              />
              <StatRow
                label="Days since update"
                value={renderWholeNumber(dataSections.growth.daysSinceLastUpdate)}
              />
            </div>
            <SectionNote note={dataSections.growth.note} />
          </SurfacePanel>

          <SurfacePanel title="Page metadata">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.pageMeta.status)}
              />
              <StatRow
                label="Seller"
                value={dataSections.pageMeta.sellerName ?? 'Unavailable'}
              />
              <StatRow
                label="Seller ID"
                value={renderWholeNumber(dataSections.pageMeta.sellerId)}
              />
              <StatRow
                label="Private server price"
                value={formatRobux(dataSections.pageMeta.privateServerPrice, 'Unavailable')}
              />
              <StatRow
                label="Private server product"
                value={renderWholeNumber(
                  dataSections.pageMeta.privateServerProductId,
                )}
              />
              <StatRow
                label="Page can create server"
                value={
                  dataSections.pageMeta.canCreateServer == null
                    ? 'Unavailable'
                    : dataSections.pageMeta.canCreateServer
                      ? 'Yes'
                      : 'No'
                }
              />
            </div>
            <SectionNote note={dataSections.pageMeta.note} />
          </SurfacePanel>

          <SurfacePanel title="Creator profile">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.creatorProfile.status)}
              />
              <StatRow label="Creator type" value={game.creatorType} />
              <StatRow
                label="Creator ID"
                value={renderWholeNumber(normalizedGame.creatorId)}
              />
              <StatRow
                label="Verified"
                value={dataSections.creatorProfile.hasVerifiedBadge ? <VerifiedBadge /> : 'No'}
              />
              <StatRow
                label="Member count"
                value={renderWholeNumber(dataSections.creatorProfile.memberCount)}
              />
              <StatRow
                label="Profile created"
                value={formatDate(dataSections.creatorProfile.created)}
              />
              <StatRow
                label="Profile URL"
                value={dataSections.creatorProfile.profileUrl ?? 'Unavailable'}
              />
            </div>
            <SectionNote note={dataSections.creatorProfile.note} />
            <div
              style={{
                color: TOKENS.colors.neutral2,
                fontSize: TOKENS.typography.body3.size,
                lineHeight: TOKENS.typography.body3.lineHeight,
              }}
            >
              {dataSections.creatorProfile.description || 'No public creator description returned.'}
            </div>
          </SurfacePanel>

          <SurfacePanel title="Server sample">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.servers.status)}
              />
              <StatRow
                label="Exact active servers"
                value={renderWholeNumber(
                  dataSections.servers.exactActiveServerCount,
                )}
              />
              <StatRow
                label="Estimated active servers"
                value={renderWholeNumber(
                  dataSections.servers.estimatedActiveServerCount,
                )}
              />
              <StatRow
                label="Sampled servers"
                value={renderWholeNumber(dataSections.servers.sampledServerCount)}
              />
              <StatRow
                label="Avg players/server"
                value={
                  dataSections.servers.averagePlayersPerServer == null
                    ? 'Unavailable'
                    : <AnimatedNumber value={dataSections.servers.averagePlayersPerServer} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                }
              />
              <StatRow
                label="Fill rate"
                value={formatPercent(dataSections.servers.fillRate)}
              />
            </div>
            <SectionNote note={dataSections.servers.note} />
          </SurfacePanel>
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.lg,
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          }}
        >
          <SurfacePanel title="Financial estimates">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Estimate confidence"
                value={formatConfidence(dataSections.financials.confidence)}
              />
              <StatRow
                label="Revenue per visit"
                value={
                  dataSections.financials.estimatedRevenuePerVisit.low != null &&
                  dataSections.financials.estimatedRevenuePerVisit.high != null
                    ? (
                        <>
                          <AnimatedNumber
                            value={dataSections.financials.estimatedRevenuePerVisit.low}
                            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                          />
                          -
                          <AnimatedNumber
                            value={dataSections.financials.estimatedRevenuePerVisit.high}
                            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                          /> R$
                        </>
                      )
                    : 'Unavailable'
                }
              />
              <StatRow
                label="Daily revenue"
                value={formatUsdRange(dataSections.financials.estimatedDailyRevenueUsd)}
              />
              <StatRow
                label="Monthly revenue"
                value={formatUsdRange(dataSections.financials.estimatedMonthlyRevenueUsd)}
              />
              <StatRow
                label="Annual run rate"
                value={formatUsdRange(dataSections.financials.estimatedAnnualRunRateUsd)}
              />
              <StatRow
                label="Valuation range"
                value={formatUsdRange(dataSections.financials.estimatedValuationUsd)}
              />
            </div>
            <SectionNote note={dataSections.financials.note} />
            <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
              {dataSections.financials.methodology.map((entry) => (
                <div
                  key={entry}
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  {entry}
                </div>
              ))}
            </div>
          </SurfacePanel>

          <SurfacePanel title="Monetization model">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.monetization.status)}
              />
              <StatRow label="Strategy" value={dataSections.monetization.strategy} />
              <StatRow
                label="Premium payouts likely"
                value={
                  dataSections.monetization.hasPremiumPayoutsLikely == null
                    ? 'Unavailable'
                    : dataSections.monetization.hasPremiumPayoutsLikely
                      ? 'Yes'
                      : 'No'
                }
              />
              <StatRow
                label="Game passes"
                value={renderWholeNumber(dataSections.monetization.gamePassCount)}
              />
              <StatRow
                label="Developer products"
                value={renderWholeNumber(dataSections.monetization.developerProductCount)}
              />
              <StatRow
                label="Avg pass price"
                value={formatRobux(dataSections.monetization.averageGamePassPrice, 'Unavailable')}
              />
              <StatRow
                label="Pass count vs genre"
                value={formatSignedPercentValue(dataSections.monetization.gamePassCountVsGenreAverage)}
              />
              <StatRow
                label="Pass price vs genre"
                value={formatSignedPercentValue(
                  dataSections.monetization.averageGamePassPriceVsGenreAverage,
                )}
              />
            </div>
            <SectionNote note={dataSections.monetization.note} />
          </SurfacePanel>

          <SurfacePanel title="Developer summary">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.developerSummary.status)}
              />
              <StatRow
                label="Portfolio monthly revenue"
                value={formatUsdRange(
                  dataSections.developerSummary.estimatedPortfolioMonthlyRevenueUsd,
                )}
              />
              <StatRow
                label="Track record score"
                value={renderWholeNumber(dataSections.developerSummary.trackRecordScore)}
              />
            </div>
            <SectionNote note={dataSections.developerSummary.note} />
          </SurfacePanel>

          <SurfacePanel title="Description">
            <div
              style={{
                color: TOKENS.colors.neutral2,
                fontSize: TOKENS.typography.body2.size,
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
              }}
            >
              {normalizedGame.description || 'No public description returned.'}
            </div>
          </SurfacePanel>

          <SurfacePanel title="Creator portfolio">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.creatorPortfolio.status)}
              />
              <StatRow
                label="Other games found"
                value={renderWholeNumber(dataSections.creatorPortfolio.totalCount)}
              />
            </div>
            <SectionNote note={dataSections.creatorPortfolio.note} />
            <PortfolioPreview games={dataSections.creatorPortfolio.games} />
          </SurfacePanel>

          <SurfacePanel title="Store inventory">
            <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
              <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
                <StatRow
                  label="Game passes"
                  value={formatAvailability(dataSections.store.gamePasses.status)}
                />
                <StatRow
                  label="Pass count"
                  value={renderWholeNumber(dataSections.store.gamePasses.totalCount)}
                />
                <SectionNote note={dataSections.store.gamePasses.note} />
              </div>

              <InventoryPreview title="Pass items" items={dataSections.store.gamePasses.items} />

              <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
                <StatRow
                  label="Developer products"
                  value={formatAvailability(
                    dataSections.store.developerProducts.status,
                  )}
                />
                <StatRow
                  label="Product count"
                  value={renderWholeNumber(dataSections.store.developerProducts.totalCount)}
                />
                <SectionNote note={dataSections.store.developerProducts.note} />
              </div>

              <InventoryPreview
                title="Developer products"
                items={dataSections.store.developerProducts.items}
              />
            </div>
          </SurfacePanel>
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.lg,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          <SurfacePanel title="Comparable games">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.comparables.status)}
              />
              <StatRow
                label="Comparable count"
                value={renderWholeNumber(dataSections.comparables.games.length)}
              />
            </div>
            <SectionNote note={dataSections.comparables.note} />
            <ComparablePreview games={dataSections.comparables.games} />
          </SurfacePanel>

          <SurfacePanel title="Social and discovery">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Status"
                value={formatAvailability(dataSections.socialDiscovery.status)}
              />
              <StatRow
                label="YouTube"
                value={dataSections.socialDiscovery.youtube ?? 'Unavailable'}
              />
              <StatRow
                label="TikTok"
                value={dataSections.socialDiscovery.tiktok ?? 'Unavailable'}
              />
              <StatRow label="X" value={dataSections.socialDiscovery.x ?? 'Unavailable'} />
              <StatRow
                label="Roblox search trend"
                value={dataSections.socialDiscovery.robloxSearchTrend ?? 'Unavailable'}
              />
            </div>
            <SectionNote note={dataSections.socialDiscovery.note} />
          </SurfacePanel>

          <SurfacePanel title="Heatpage">
            <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
              <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
                <StatRow
                  label="Heatmap status"
                  value={formatAvailability(dataSections.players.status)}
                />
                <StatRow
                  label="Hourly windows"
                  value={renderWholeNumber(dataSections.players.hourlyHeatmap.length)}
                />
              </div>

              {dataSections.players.hourlyHeatmap.length === 0 ? (
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  No hourly player pattern data returned.
                </div>
              ) : (
                <PlayerHeatmap
                  items={dataSections.players.hourlyHeatmap}
                  caption="Preview only. Open the dedicated heatpage for the full view."
                />
              )}

              <div>
                <MarketButton
                  type="button"
                  variant="secondary"
                  onClick={onOpenHeatPage}
                >
                  Open heatpage
                </MarketButton>
              </div>
            </div>
          </SurfacePanel>

          <SurfacePanel title="Screenshots">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow
                label="Screenshot count"
                value={renderWholeNumber(normalizedGame.screenshotUrls.length)}
              />
              {screenshotUrls.length === 0 ? (
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  No screenshot thumbnails returned.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: TOKENS.spacing.sm,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  }}
                >
                  {screenshotUrls.map((imageUrl) => (
                    <div
                      key={imageUrl}
                      className="market-glass-frame"
                      style={{
                        aspectRatio: '16 / 9',
                        borderRadius: '12px',
                        background: TOKENS.colors.surface2,
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={imageUrl}
                        alt=""
                        className="market-glass-image"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SurfacePanel>

          <SurfacePanel title="Sample servers">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              {(dataSections.servers.servers ?? []).length === 0 ? (
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  No server rows returned.
                </div>
              ) : (
                (dataSections.servers.servers ?? []).slice(0, 8).map((server) => (
                  <div
                    key={server.id}
                    style={{
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: isMobile ? 'flex-start' : 'center',
                      justifyContent: 'space-between',
                      gap: TOKENS.spacing.md,
                    }}
                  >
                    <span
                      style={{
                        color: TOKENS.colors.neutral1,
                        fontSize: TOKENS.typography.body2.size,
                        lineHeight: TOKENS.typography.body2.lineHeight,
                      }}
                    >
                      <WholeNumber value={server.playing} />/<WholeNumber value={server.maxPlayers} />
                    </span>
                    <span
                      style={{
                        color: TOKENS.colors.neutral2,
                        fontSize: TOKENS.typography.body3.size,
                        lineHeight: TOKENS.typography.body3.lineHeight,
                        whiteSpace: isMobile ? 'normal' : 'nowrap',
                      }}
                    >
                      {server.ping == null ? 'Ping n/a' : <><WholeNumber value={server.ping} /> ms</>} ·{' '}
                      {server.fps == null ? 'FPS n/a' : <><AnimatedNumber value={server.fps} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> fps</>}
                    </span>
                  </div>
                ))
              )}
            </div>
          </SurfacePanel>
        </section>
        </main>

        {sharePreviewUrl ? (
          <div
          role="dialog"
          aria-modal="true"
          aria-label="Share image preview"
          onClick={closeSharePreview}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(100%, 760px)',
              display: 'grid',
              gap: TOKENS.spacing.md,
              justifyItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: isMobile ? 'flex-start' : 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: TOKENS.spacing.md,
                width: '100%',
              }}
            >
              <div style={{ display: 'grid', gap: '4px' }}>
                <strong
                  style={{
                    fontSize: TOKENS.typography.heading2.size,
                    lineHeight: TOKENS.typography.heading2.lineHeight,
                    fontWeight: TOKENS.typography.heading2.weight,
                    letterSpacing: TOKENS.typography.heading2.letterSpacing,
                  }}
                >
                  Share Preview
                </strong>
                <span
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body2.size,
                    lineHeight: TOKENS.typography.body2.lineHeight,
                  }}
                >
                  Export a sleek snapshot of this game page to share.
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: isMobile ? 'stretch' : 'center',
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: TOKENS.spacing.sm,
                  width: isMobile ? '100%' : undefined,
                }}
              >
                <MarketButton
                  type="button"
                  variant="secondary"
                  style={{ width: isMobile ? '100%' : undefined }}
                  onClick={handleSharePreview}
                >
                  Share image
                </MarketButton>
                <MarketButton
                  type="button"
                  variant="secondary"
                  style={{ width: isMobile ? '100%' : undefined }}
                  onClick={() => {
                    if (!sharePreviewUrl || !sharePreviewFile) {
                      return
                    }

                    const anchor = document.createElement('a')
                    anchor.href = sharePreviewUrl
                    anchor.download = sharePreviewFile.name
                    document.body.appendChild(anchor)
                    anchor.click()
                    anchor.remove()
                  }}
                >
                  Download PNG
                </MarketButton>
                <MarketButton
                  type="button"
                  variant="outline"
                  style={{ width: isMobile ? '100%' : undefined }}
                  onClick={closeSharePreview}
                >
                  Close
                </MarketButton>
              </div>
            </div>

            <div
              style={{
                borderRadius: TOKENS.radii.xxl,
                border: `1px solid ${TOKENS.colors.surface3}`,
                background: TOKENS.colors.surface1,
                padding: TOKENS.spacing.sm,
                display: 'grid',
                placeItems: 'center',
                width: 'fit-content',
                maxWidth: '100%',
                boxShadow: '0 30px 90px rgba(0, 0, 0, 0.42)',
              }}
            >
              <img
                src={sharePreviewUrl}
                alt={`${game.name} share preview`}
                style={{
                  display: 'block',
                  width: isMobile ? 'min(82vw, 360px)' : 'min(70vw, 520px)',
                  maxWidth: '100%',
                  maxHeight: '72vh',
                  height: isMobile ? 'min(82vw, 360px)' : 'min(70vw, 520px)',
                  borderRadius: TOKENS.radii.xxl,
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>
          </div>
        ) : null}
      </div>
    </GamePageCompactContext.Provider>
  )
}
