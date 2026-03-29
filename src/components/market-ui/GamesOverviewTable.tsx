import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { ArrowDown } from 'lucide-react'

import { TOKENS } from '../../design/marketTokens'
import { PercentNumber } from '../ui/AnimatedNumber'
import { MiniTrendChart } from './MiniTrendChart'
import { Skeleton } from './Skeleton'

export type GamesOverviewRow = {
  rank: number
  universeId?: number
  name: string
  studio: string
  playersLabel: ReactNode
  change1h: number
  change24h: number
  ratingLabel: ReactNode
  visitsLabel: ReactNode
  chartTone: 'positive' | 'negative' | 'neutral'
  trend: number[]
  accentColor: string
  thumbnailUrl?: string
}

export type CompactGamesOverviewRow = {
  rank?: number
  universeId?: number
  name: string
  studio: string
  primaryValue: ReactNode
  primarySortValue?: number
  secondaryValue?: ReactNode
  secondarySortValue?: number
  deltaLabel?: string
  deltaValue?: number
  trend?: number[]
  chartTone?: 'positive' | 'negative' | 'neutral'
  accentColor: string
  thumbnailUrl?: string
}

type FullGamesOverviewTableProps = {
  variant?: 'full'
  rows: GamesOverviewRow[]
  loading?: boolean
  skeletonRowCount?: number
  onRowClick?: (row: GamesOverviewRow) => void
}

type CompactGamesOverviewTableProps = {
  variant: 'compact'
  rows: CompactGamesOverviewRow[]
  loading?: boolean
  skeletonRowCount?: number
  primaryLabel: string
  secondaryLabel?: string
  deltaLabel?: string
  showTrend?: boolean
  showRank?: boolean
  onRowClick?: (row: CompactGamesOverviewRow) => void
}

type GamesOverviewTableProps =
  | FullGamesOverviewTableProps
  | CompactGamesOverviewTableProps

type CompactSortKey = 'game' | 'primary' | 'secondary' | 'delta' | null

function CompactHeaderButton({
  label,
  active = false,
  direction = 'desc',
  align = 'right',
  onClick,
}: {
  label: string
  active?: boolean
  direction?: 'asc' | 'desc'
  align?: 'left' | 'right'
  onClick?: () => void
}) {
  const justifyContent = align === 'left' ? 'flex-start' : 'flex-end'

  if (!onClick) {
    return (
      <span style={{ textAlign: align, justifySelf: align === 'left' ? 'start' : 'end' }}>
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent,
        gap: '6px',
        width: '100%',
        color: active ? TOKENS.colors.neutral1 : TOKENS.colors.neutral2,
        fontSize: TOKENS.typography.body2.size,
        lineHeight: TOKENS.typography.body2.lineHeight,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        textAlign: align,
        justifySelf: align === 'left' ? 'start' : 'end',
      }}
    >
      {active ? (
        <ArrowDown
          size={14}
          strokeWidth={2.4}
          style={{
            transform: direction === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        />
      ) : null}
      <span>{label}</span>
    </button>
  )
}

function DeltaValue({ value }: { value: number }) {
  const tone =
    value > 0
      ? TOKENS.colors.success
      : value < 0
        ? TOKENS.colors.critical
        : TOKENS.colors.neutral3
  const rotation = value < 0 ? '180deg' : '0deg'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        color: tone,
        fontSize: TOKENS.typography.body2.size,
        lineHeight: TOKENS.typography.body2.lineHeight,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        justifySelf: 'end',
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        style={{ color: tone, transform: `rotate(${rotation})` }}
      >
        <path d="M6 2 11 10H1L6 2Z" fill="currentColor" />
      </svg>
      <PercentNumber
        value={Math.abs(value)}
        fractionDigits={2}
        style={{ color: TOKENS.colors.neutral1 }}
      />
    </span>
  )
}

function GameBadge({
  label,
  size = 48,
  imageUrl,
  universeId,
}: {
  label: string
  size?: number
  imageUrl?: string
  universeId?: number
}) {
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const retryUrl =
    retryNonce > 0 && universeId != null ? `/api/game-icon/${universeId}?refresh=${retryNonce}` : null
  const activeImageUrl =
    retryUrl ?? imageUrl ?? (universeId != null ? `/api/game-icon/${universeId}` : null)
  const showImage =
    Boolean(activeImageUrl) &&
    loadedImageUrl === activeImageUrl &&
    failedImageUrl !== activeImageUrl

  return (
    <div
      className="market-glass-frame"
      aria-label={label}
      title={label}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '25%',
        background: TOKENS.colors.surface2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: TOKENS.colors.neutral1,
        fontSize: `${Math.max(size * 0.32, 11)}px`,
        fontWeight: 700,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {activeImageUrl && failedImageUrl !== activeImageUrl ? (
        <img
          src={activeImageUrl}
          alt=""
          onLoad={() => setLoadedImageUrl(activeImageUrl)}
          onError={() => {
            if (retryNonce === 0 && universeId != null && imageUrl != null) {
              setRetryNonce(Date.now())
              return
            }

            setFailedImageUrl(activeImageUrl)
          }}
          className="market-glass-image"
          style={{
            display: showImage ? 'block' : 'none',
          }}
        />
      ) : null}
      {!showImage ? (
        <Skeleton
          width="100%"
          height="100%"
          radius={`${Math.round(size * 0.25)}px`}
        />
      ) : null}
    </div>
  )
}

export function GamesOverviewTable(props: GamesOverviewTableProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const isCompact = props.variant === 'compact'
  const [sortKey, setSortKey] = useState<CompactSortKey>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const applySort = (nextKey: Exclude<CompactSortKey, null>) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
      return
    }

    setSortKey(nextKey)
    setSortDirection(nextKey === 'game' ? 'asc' : 'desc')
  }

  const displayedCompactRows = useMemo(() => {
    if (!isCompact || !sortKey) {
      return isCompact ? (props as CompactGamesOverviewTableProps).rows : []
    }

    const compactRows = (props as CompactGamesOverviewTableProps).rows
    const sorted = [...compactRows]

    sorted.sort((left, right) => {
      const directionFactor = sortDirection === 'asc' ? 1 : -1

      if (sortKey === 'game') {
        return left.name.localeCompare(right.name) * directionFactor
      }

      if (sortKey === 'primary') {
        return (
          ((left.primarySortValue ?? Number.NEGATIVE_INFINITY) -
            (right.primarySortValue ?? Number.NEGATIVE_INFINITY)) *
          directionFactor
        )
      }

      if (sortKey === 'secondary') {
        return (
          ((left.secondarySortValue ?? Number.NEGATIVE_INFINITY) -
            (right.secondarySortValue ?? Number.NEGATIVE_INFINITY)) *
          directionFactor
        )
      }

      return (
        ((left.deltaValue ?? Number.NEGATIVE_INFINITY) -
          (right.deltaValue ?? Number.NEGATIVE_INFINITY)) *
        directionFactor
      )
    })

    return sorted
  }, [isCompact, props, sortDirection, sortKey])

  if (isCompact) {
    const {
      rows,
      loading = false,
      skeletonRowCount = 8,
      primaryLabel,
      secondaryLabel,
      deltaLabel,
      showTrend = false,
      showRank = true,
      onRowClick,
    } = props

    return (
      <div
        style={{
          background: 'transparent',
          border: `1px solid ${TOKENS.colors.surface3}`,
          borderRadius: '24px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${showRank ? '32px ' : ''}minmax(0, 1fr) minmax(88px,auto)${
              secondaryLabel ? ' minmax(88px,auto)' : ''
            }${deltaLabel ? ' minmax(88px,auto)' : ''}${showTrend ? ' 120px' : ''}`,
            gap: TOKENS.spacing.lg,
            padding: '12px 20px',
            borderBottom: `1px solid ${TOKENS.colors.surface3}`,
            background: TOKENS.colors.surface2,
            color: TOKENS.colors.neutral2,
            fontSize: TOKENS.typography.body2.size,
            lineHeight: TOKENS.typography.body2.lineHeight,
            fontWeight: 500,
          }}
        >
          {showRank ? <span>#</span> : null}
          <CompactHeaderButton
            label="Game"
            align="left"
            active={sortKey === 'game'}
            direction={sortDirection}
            onClick={() => applySort('game')}
          />
          <CompactHeaderButton
            label={primaryLabel}
            active={sortKey === 'primary'}
            direction={sortDirection}
            onClick={() => applySort('primary')}
          />
          {secondaryLabel ? (
            <CompactHeaderButton
              label={secondaryLabel}
              active={sortKey === 'secondary'}
              direction={sortDirection}
              onClick={() => applySort('secondary')}
            />
          ) : null}
          {deltaLabel ? (
            <CompactHeaderButton
              label={deltaLabel}
              active={sortKey === 'delta'}
              direction={sortDirection}
              onClick={() => applySort('delta')}
            />
          ) : null}
          {showTrend ? <span style={{ textAlign: 'right', justifySelf: 'end' }}>Trend</span> : null}
        </div>

        <div style={{ display: 'grid', gap: '4px', padding: '6px' }}>
          {loading && rows.length === 0
            ? Array.from({ length: skeletonRowCount }, (_, index) => (
                <div
                  key={`compact-skeleton-${index}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `${showRank ? '32px ' : ''}minmax(0, 1fr) minmax(88px,auto)${
                      secondaryLabel ? ' minmax(88px,auto)' : ''
                    }${deltaLabel ? ' minmax(88px,auto)' : ''}${showTrend ? ' 120px' : ''}`,
                    gap: TOKENS.spacing.lg,
                    alignItems: 'center',
                    minHeight: '56px',
                    padding: '0 16px',
                    borderRadius: '16px',
                  }}
                >
                  {showRank ? <Skeleton width="24px" height="26px" /> : null}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: TOKENS.spacing.md,
                      minWidth: 0,
                    }}
                  >
                    <Skeleton width="48px" height="48px" radius="12px" />
                    <Skeleton width="clamp(180px, 38vw, 380px)" height="26px" />
                  </div>

                  <Skeleton width="88px" height="26px" style={{ justifySelf: 'end' }} />
                  {secondaryLabel ? (
                    <Skeleton width="96px" height="26px" style={{ justifySelf: 'end' }} />
                  ) : null}
                  {deltaLabel ? (
                    <Skeleton width="104px" height="26px" style={{ justifySelf: 'end' }} />
                  ) : null}
                  {showTrend ? (
                    <Skeleton width="96px" height="26px" style={{ justifySelf: 'end' }} />
                  ) : null}
                </div>
              ))
            : displayedCompactRows.map((row, index) => {
            const hoverKey = row.rank ?? index + 1

            return (
              <div
                key={row.universeId ?? `${row.name}-${row.studio}-${hoverKey}`}
                onMouseEnter={() => setHoveredRow(hoverKey)}
                onMouseLeave={() => setHoveredRow(null)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `${showRank ? '32px ' : ''}minmax(0, 1fr) minmax(88px,auto)${
                    secondaryLabel ? ' minmax(88px,auto)' : ''
                  }${deltaLabel ? ' minmax(88px,auto)' : ''}${showTrend ? ' 120px' : ''}`,
                  gap: TOKENS.spacing.lg,
                  alignItems: 'center',
                  minHeight: '56px',
                  padding: '0 16px',
                  borderRadius: '16px',
                  background:
                    hoveredRow === hoverKey ? TOKENS.colors.surface2 : 'transparent',
                  transition: `background ${TOKENS.transitions.fast}`,
                  cursor: onRowClick ? 'pointer' : 'default',
                }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {showRank ? (
                  <span
                    style={{
                      color: TOKENS.colors.neutral1,
                      fontSize: TOKENS.typography.body2.size,
                      lineHeight: TOKENS.typography.body2.lineHeight,
                    }}
                  >
                    {row.rank ?? index + 1}
                  </span>
                ) : null}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: TOKENS.spacing.sm,
                    minWidth: 0,
                  }}
                >
                  <GameBadge
                    label={row.name}
                    size={48}
                    imageUrl={row.thumbnailUrl}
                    universeId={row.universeId}
                  />
                  <div
                    style={{
                      display: 'grid',
                      gap: '6px',
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: TOKENS.typography.body2.size,
                        lineHeight: TOKENS.typography.body2.lineHeight,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {row.name}
                    </span>
                    <span
                      style={{
                        color: TOKENS.colors.neutral2,
                        fontSize: TOKENS.typography.body3.size,
                        lineHeight: TOKENS.typography.body3.lineHeight,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {row.studio}
                    </span>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: TOKENS.typography.body2.size,
                    lineHeight: TOKENS.typography.body2.lineHeight,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                    justifySelf: 'end',
                  }}
                >
                  {row.primaryValue}
                </span>

                {secondaryLabel ? (
                  <span
                    style={{
                      color: TOKENS.colors.neutral1,
                      fontSize: TOKENS.typography.body2.size,
                      lineHeight: TOKENS.typography.body2.lineHeight,
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                      justifySelf: 'end',
                    }}
                  >
                    {row.secondaryValue}
                  </span>
                ) : null}

                {deltaLabel ? (
                  row.deltaValue !== undefined ? (
                    <DeltaValue value={row.deltaValue} />
                  ) : (
                    <span style={{ color: TOKENS.colors.neutral1 }}>-</span>
                  )
                ) : null}

                {showTrend ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <MiniTrendChart
                      points={row.trend ?? []}
                      tone={row.chartTone ?? 'neutral'}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const {
    rows,
    loading = false,
    skeletonRowCount = 8,
    onRowClick,
  } = props

  return (
    <div
      style={{
        background: 'transparent',
        border: `1px solid ${TOKENS.colors.surface3}`,
        borderRadius: '28px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 2.5fr 1.1fr 1fr 1fr 1.1fr 1.1fr 144px',
          padding: '14px 20px',
          borderBottom: `1px solid ${TOKENS.colors.surface3}`,
          background: TOKENS.colors.surface2,
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body2.size,
          lineHeight: TOKENS.typography.body2.lineHeight,
          fontWeight: 500,
        }}
      >
        <span>#</span>
        <span>Game</span>
        <span style={{ textAlign: 'right' }}>Players</span>
        <span style={{ textAlign: 'right' }}>1H</span>
        <span style={{ textAlign: 'right' }}>24H</span>
        <span style={{ textAlign: 'right' }}>Rating</span>
        <span style={{ textAlign: 'right' }}>Visits</span>
        <span style={{ textAlign: 'right' }}>Trend</span>
      </div>

      <div style={{ display: 'grid', gap: '4px', padding: '6px' }}>
        {loading && rows.length === 0
          ? Array.from({ length: skeletonRowCount }, (_, index) => (
              <div
                key={`full-skeleton-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 2.5fr 1.1fr 1fr 1fr 1.1fr 1.1fr 144px',
                  alignItems: 'center',
                  minHeight: '64px',
                  padding: '0 16px',
                  borderRadius: '18px',
                  gap: TOKENS.spacing.lg,
                }}
              >
                <Skeleton width="24px" height="26px" />
                <Skeleton width="clamp(220px, 28vw, 420px)" height="26px" />
                <Skeleton width="96px" height="26px" style={{ justifySelf: 'end' }} />
                <Skeleton width="88px" height="26px" style={{ justifySelf: 'end' }} />
                <Skeleton width="88px" height="26px" style={{ justifySelf: 'end' }} />
                <Skeleton width="96px" height="26px" style={{ justifySelf: 'end' }} />
                <Skeleton width="96px" height="26px" style={{ justifySelf: 'end' }} />
                <Skeleton width="104px" height="26px" style={{ justifySelf: 'end' }} />
              </div>
            ))
          : rows.map((row) => (
          <div
            key={row.universeId ?? `${row.rank}-${row.name}`}
            onMouseEnter={() => setHoveredRow(row.rank)}
            onMouseLeave={() => setHoveredRow(null)}
            style={{
              display: 'grid',
              gridTemplateColumns: '48px 2.5fr 1.1fr 1fr 1fr 1.1fr 1.1fr 144px',
              alignItems: 'center',
              minHeight: '64px',
              padding: '0 16px',
              borderRadius: '18px',
              background:
                hoveredRow === row.rank ? TOKENS.colors.surface2 : 'transparent',
              transition: `background ${TOKENS.transitions.fast}`,
              cursor: onRowClick ? 'pointer' : 'default',
            }}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <span
              style={{
                color: TOKENS.colors.neutral1,
                fontSize: TOKENS.typography.body2.size,
                lineHeight: TOKENS.typography.body2.lineHeight,
                fontWeight: 500,
              }}
            >
              {row.rank}
            </span>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: TOKENS.spacing.md,
                minWidth: 0,
              }}
            >
              <GameBadge
                label={row.name}
                size={48}
                imageUrl={row.thumbnailUrl}
                universeId={row.universeId}
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: TOKENS.typography.body2.size,
                    fontWeight: 500,
                    lineHeight: TOKENS.typography.body2.lineHeight,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.name}
                </span>
                <span
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.studio}
                </span>
              </div>
            </div>

            <span
              style={{
                fontSize: TOKENS.typography.body2.size,
                fontWeight: 500,
              }}
            >
              {row.playersLabel}
            </span>
            <DeltaValue value={row.change1h} />
            <DeltaValue value={row.change24h} />
            <span
              style={{
                fontSize: TOKENS.typography.body2.size,
                fontWeight: 500,
              }}
            >
              {row.ratingLabel}
            </span>
            <span
              style={{
                fontSize: TOKENS.typography.body2.size,
                fontWeight: 500,
              }}
            >
              {row.visitsLabel}
            </span>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <MiniTrendChart points={row.trend} tone={row.chartTone} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
