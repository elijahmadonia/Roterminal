import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPlatformLivePoint } from '../api/roblox'
import { GamesOverviewTable } from '../components/market-ui/GamesOverviewTable'
import { LiveLineChart } from '../components/market-ui/LiveLineChart'
import { LiveMetricHero } from '../components/market-ui/LiveMetricHero'
import { SegmentedControl } from '../components/market-ui/SegmentedControl'
import { TopFiveLiveSeriesChart } from '../components/market-ui/TopFiveLiveSeriesChart'
import { UnderlineTabs } from '../components/market-ui/UnderlineTabs'
import {
  ApprovalNumber,
  CompactNumber,
  WholeNumber,
} from '../components/ui/AnimatedNumber'
import { useRollingLiveline } from '../hooks/useRollingLiveline'
import { useLiveBoard } from '../hooks/useLiveBoard'
import { useLivePlatform } from '../hooks/useLivePlatform'
import { usePlatformLivePoint } from '../hooks/usePlatformLivePoint'
import { TOKENS } from '../design/marketTokens'
import type { ChartRange, LiveLeaderboardRow, TrendPoint } from '../types'
import type { LivelinePoint } from 'liveline'

type HomePageProps = {
  onOpenGame: (game: { universeId?: number; name: string }) => void
}

const HOME_WINDOW_OPTIONS = [
  { label: 'Live', secs: 60 },
  { label: '1D', secs: 24 * 60 * 60 },
  { label: '1W', secs: 7 * 24 * 60 * 60 },
  { label: '1M', secs: 30 * 24 * 60 * 60 },
] as const
const HOME_TABLE_BATCH_SIZE = 25
const TOP_THREE_SERIES_COLORS = [
  TOKENS.colors.accent1,
  'rgb(216, 151, 31)',
  'rgb(28, 226, 183)',
] as const

function toLiveLineData(points: Array<{ timestamp?: string; value: number }>): LivelinePoint[] {
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

function toLiveLineSeed(
  points: Array<{ timestamp?: string; value: number }>,
  latestPoint?: { timestamp?: string; value: number } | null,
): LivelinePoint[] {
  const timelineData = toLiveLineData(points)

  if (timelineData.length > 0) {
    return timelineData
  }

  if (!latestPoint) {
    return []
  }

  const parsedTimestamp = latestPoint.timestamp ? Date.parse(latestPoint.timestamp) : Number.NaN

  return [
    {
      time: Number.isNaN(parsedTimestamp)
        ? Math.floor(Date.now() / 1000)
        : Math.floor(parsedTimestamp / 1000),
      value: latestPoint.value,
    },
  ]
}

function getCoverageSeconds(points: Array<{ timestamp?: string }>) {
  const timestamps = points
    .map((point) => (point.timestamp ? Date.parse(point.timestamp) : Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  if (timestamps.length <= 1) {
    return 0
  }

  return Math.max(Math.floor((timestamps.at(-1)! - timestamps[0]!) / 1000), 0)
}

function formatCoverageNote(coverageSeconds: number, targetSeconds: number, label: string) {
  if (coverageSeconds <= 0 || coverageSeconds >= targetSeconds * 0.9) {
    return undefined
  }

  if (coverageSeconds < 60 * 60) {
    return `Tracking ${Math.max(1, Math.round(coverageSeconds / 60))}m of data so far for ${label}.`
  }

  if (coverageSeconds < 24 * 60 * 60) {
    return `Tracking ${(coverageSeconds / (60 * 60)).toFixed(1)}h of data so far for ${label}.`
  }

  return `Tracking ${(coverageSeconds / (24 * 60 * 60)).toFixed(1)}d of data so far for ${label}.`
}

export default function HomePage({
  onOpenGame,
}: HomePageProps) {
  const [heroRange, setHeroRange] = useState<'Live' | '1D' | '1W' | '1M'>('1D')
  const [hiddenTopThreeIds, setHiddenTopThreeIds] = useState<number[]>([])
  const [gamesView, setGamesView] = useState<
    'Top Games' | 'Trending' | 'Gainers' | 'Losers' | 'Breakouts'
  >('Top Games')
  const [visibleTableRowCount, setVisibleTableRowCount] = useState(HOME_TABLE_BATCH_SIZE)
  const tableLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const handleGamesViewChange = useCallback(
    (nextView: 'Top Games' | 'Trending' | 'Gainers' | 'Losers' | 'Breakouts') => {
      setGamesView(nextView)
      setVisibleTableRowCount(HOME_TABLE_BATCH_SIZE)
    },
    [],
  )
  const activeHeroWindow =
    HOME_WINDOW_OPTIONS.find((option) => option.label === heroRange) ?? HOME_WINDOW_OPTIONS[0]
  const platformHeroRange: ChartRange = heroRange === 'Live' ? '1h' : '24h'
  const platformHeroWindowSeconds = heroRange === 'Live' ? 60 * 60 : activeHeroWindow.secs
  const topFiveWindow = activeHeroWindow
  const {
    data: livePlatform,
    isLoading: isPlatformLoading,
  } = useLivePlatform(platformHeroRange)
  const {
    data: livePlatformPoint,
    isLoading: isPlatformPointLoading,
  } = usePlatformLivePoint(heroRange === 'Live')
  const {
    data: liveBoard,
    isLoading: isBoardLoading,
  } = useLiveBoard('24h')
  const platformHistoricalLine = useMemo(
    () => toLiveLineData(livePlatform?.timeline ?? []),
    [livePlatform?.timeline],
  )
  const platformHistoryCoverageSeconds = useMemo(
    () => getCoverageSeconds(livePlatform?.timeline ?? []),
    [livePlatform?.timeline],
  )
  const boardHistoryCoverageSeconds = useMemo(
    () => getCoverageSeconds(liveBoard?.timeline ?? []),
    [liveBoard?.timeline],
  )
  const historicalPlatformWindowSeconds =
    platformHistoryCoverageSeconds > 0
      ? Math.min(activeHeroWindow.secs, platformHistoryCoverageSeconds + 300)
      : activeHeroWindow.secs
  const historicalBoardWindowSeconds =
    boardHistoryCoverageSeconds > 0
      ? Math.min(topFiveWindow.secs, boardHistoryCoverageSeconds + 300)
      : topFiveWindow.secs
  const platformHistoryNote =
    heroRange === 'Live'
      ? undefined
      : formatCoverageNote(platformHistoryCoverageSeconds, activeHeroWindow.secs, heroRange)
  const homeLineSeed = useMemo(
    () => toLiveLineSeed(livePlatform?.timeline ?? [], livePlatform?.latest ?? livePlatformPoint),
    [livePlatform?.latest, livePlatform?.timeline, livePlatformPoint],
  )
  const homeLiveLine = useRollingLiveline({
    initialData: homeLineSeed,
    windowSeconds: platformHeroWindowSeconds,
    reseedKey: platformHeroRange,
    enabled: heroRange === 'Live',
    pollIntervalMs: 4_000,
    heartbeatMs: 250,
    fetchLatest: fetchPlatformLivePoint,
  })
  const platformHeroChartData = heroRange === 'Live'
    ? homeLiveLine.data
    : platformHistoricalLine
  const platformChartWindowSeconds = heroRange === 'Live'
    ? platformHeroWindowSeconds
    : historicalPlatformWindowSeconds
  const platformHeroValue = heroRange === 'Live'
    ? (homeLiveLine.latestValue ?? livePlatformPoint?.value ?? livePlatform?.latest.value ?? null)
    : (livePlatform?.latest.value ?? platformHistoricalLine.at(-1)?.value ?? null)
  const heroMetricValue = platformHeroValue != null
    ? <WholeNumber value={platformHeroValue} flashOnChange />
    : 'Unavailable'
  const isHeroChartLoading = heroRange === 'Live'
    ? isPlatformLoading && isPlatformPointLoading && platformHeroChartData.length === 0
    : isPlatformLoading && platformHeroChartData.length === 0

  const accentFromGame = (seed: string) => {
    const palette = [
      TOKENS.colors.base,
      TOKENS.colors.accent1,
      TOKENS.colors.success,
      TOKENS.colors.warning,
      '#43C7FF',
      '#8EE3A2',
      '#B793FF',
      '#F59E7A',
    ]

    const hash = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0)
    return palette[hash % palette.length]
  }

  const topLeaderboard = useMemo(
    () => liveBoard?.leaderboard ?? [],
    [liveBoard?.leaderboard],
  )
  const topFiveLeaderboard = useMemo(
    () => (liveBoard?.leaderboard ?? []).slice(0, 50),
    [liveBoard?.leaderboard],
  )
  const topFiveTimelineByUniverseId = useMemo(
    () =>
      Object.fromEntries(
        (liveBoard?.topFiveSeries ?? []).map((series) => [series.universeId, series.timeline]),
      ) as Record<number, TrendPoint[]>,
    [liveBoard?.topFiveSeries],
  )
  const topThreeLeaderboard = useMemo(
    () => topFiveLeaderboard.slice(0, 3),
    [topFiveLeaderboard],
  )
  const topThreeTotalValue = useMemo(
    () => topThreeLeaderboard.reduce((sum, game) => sum + game.playing, 0),
    [topThreeLeaderboard],
  )
  const activeHiddenTopThreeIds = useMemo(
    () =>
      hiddenTopThreeIds.filter((id) =>
        topThreeLeaderboard.some((game) => game.universeId === id),
      ),
    [hiddenTopThreeIds, topThreeLeaderboard],
  )
  const toggleTopThreeId = useCallback((universeId: number) => {
    setHiddenTopThreeIds((current) => {
      const isHidden = current.includes(universeId)

      if (isHidden) {
        return current.filter((id) => id !== universeId)
      }

      const visibleCount = topThreeLeaderboard.filter(
        (game) => !current.includes(game.universeId),
      ).length

      if (visibleCount <= 1) {
        return current
      }

      return [...current, universeId]
    })
  }, [topThreeLeaderboard])
  const topThreeLegend = useMemo(
    () => (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}
      >
        {topThreeLeaderboard.map((game, index) => (
          <button
            key={game.universeId}
            type="button"
            onClick={() => toggleTopThreeId(game.universeId)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: activeHiddenTopThreeIds.includes(game.universeId)
                ? `${TOKENS.colors.neutral2}88`
                : TOKENS.colors.neutral2,
              padding: '7px 9px',
              borderRadius: '10px',
              border: 'none',
              background: activeHiddenTopThreeIds.includes(game.universeId)
                ? 'rgba(255,255,255,0.02)'
                : 'rgba(255,255,255,0.04)',
              cursor: 'pointer',
              opacity: activeHiddenTopThreeIds.includes(game.universeId) ? 0.48 : 1,
              transition: `opacity ${TOKENS.transitions.fast}, background ${TOKENS.transitions.fast}, color ${TOKENS.transitions.fast}`,
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: TOKENS.radii.pill,
                background: TOP_THREE_SERIES_COLORS[index % TOP_THREE_SERIES_COLORS.length],
                flexShrink: 0,
                opacity: activeHiddenTopThreeIds.includes(game.universeId) ? 0.5 : 1,
              }}
            />
          </button>
        ))}
      </div>
    ),
    [activeHiddenTopThreeIds, toggleTopThreeId, topThreeLeaderboard],
  )

  const mapLiveRow = useCallback(
    (
      game: LiveLeaderboardRow,
      index: number,
      config: {
        primaryValue: ReactNode
        secondaryValue?: ReactNode
        deltaValue?: number
      },
    ) => ({
      rank: index + 1,
      universeId: game.universeId,
      name: game.name,
      studio: game.creatorName,
      primaryValue: config.primaryValue,
      primarySortValue: game.approval,
      secondaryValue: config.secondaryValue,
      secondarySortValue: game.playing,
      deltaValue: config.deltaValue,
      trend: game.sparkline,
      chartTone: game.tone,
      accentColor: accentFromGame(`${game.name}-${game.genre}`),
      thumbnailUrl: game.thumbnailUrl,
    }),
    [],
  )

  const fillTableRows = useCallback(
    (
      sortedGames: LiveLeaderboardRow[],
      predicate?: (game: LiveLeaderboardRow) => boolean,
    ) => {
      const prioritized = predicate
        ? sortedGames.filter(predicate)
        : sortedGames

      const selectedIds = new Set(prioritized.map((game) => game.universeId))
      const fallback = sortedGames.filter((game) => !selectedIds.has(game.universeId))

      return [...prioritized, ...fallback]
    },
    [],
  )

  const topGamesRows = useMemo(
    () =>
      topLeaderboard.length > 0
        ? fillTableRows(
            topLeaderboard
              .slice()
              .sort((left, right) => right.playing - left.playing),
          )
            .map((game, index) =>
              mapLiveRow(game, index, {
                primaryValue: <ApprovalNumber value={game.approval} />,
                secondaryValue: <CompactNumber value={game.playing} flashOnChange />,
                deltaValue: game.delta24h,
              }),
            )
        : [],
    [fillTableRows, mapLiveRow, topLeaderboard],
  )

  const trendingRows = useMemo(
    () =>
      topLeaderboard.length > 0
        ? fillTableRows(
            topLeaderboard
              .slice()
              .sort((left, right) => right.delta1h - left.delta1h),
            (game) => game.delta1h > 0,
          )
            .map((game, index) =>
              mapLiveRow(game, index, {
                primaryValue: <ApprovalNumber value={game.approval} />,
                secondaryValue: <CompactNumber value={game.playing} flashOnChange />,
                deltaValue: game.delta24h,
              }),
            )
        : [],
    [fillTableRows, mapLiveRow, topLeaderboard],
  )

  const topGainerRows = useMemo(
    () =>
      topLeaderboard.length > 0
        ? fillTableRows(
            topLeaderboard
              .slice()
              .sort((left, right) => right.delta24h - left.delta24h),
            (game) => game.delta24h > 0,
          )
            .map((game, index) =>
              mapLiveRow(game, index, {
                primaryValue: <ApprovalNumber value={game.approval} />,
                secondaryValue: <CompactNumber value={game.playing} flashOnChange />,
                deltaValue: game.delta24h,
              }),
            )
        : [],
    [fillTableRows, mapLiveRow, topLeaderboard],
  )

  const topLoserRows = useMemo(
    () =>
      topLeaderboard.length > 0
        ? fillTableRows(
            topLeaderboard
              .slice()
              .sort((left, right) => left.delta24h - right.delta24h),
            (game) => game.delta24h < 0,
          )
            .map((game, index) =>
              mapLiveRow(game, index, {
                primaryValue: <ApprovalNumber value={game.approval} />,
                secondaryValue: <CompactNumber value={game.playing} flashOnChange />,
                deltaValue: game.delta24h,
              }),
            )
        : [],
    [fillTableRows, mapLiveRow, topLeaderboard],
  )

  const breakoutRows = useMemo(
    () =>
      topLeaderboard.length > 0
        ? fillTableRows(
            topLeaderboard
              .slice()
              .sort((left, right) => right.delta24h - left.delta24h),
            (game) =>
              game.playing >= 10_000 &&
              game.playing <= 250_000 &&
              game.delta24h > 0,
          )
            .map((game, index) =>
              mapLiveRow(game, index, {
                primaryValue: <ApprovalNumber value={game.approval} />,
                secondaryValue: <CompactNumber value={game.playing} flashOnChange />,
                deltaValue: game.delta24h,
              }),
            )
        : [],
    [fillTableRows, mapLiveRow, topLeaderboard],
  )

  const tableConfig = useMemo(() => {
    if (gamesView === 'Trending') {
      return {
        rows: trendingRows,
        props: {
          primaryLabel: 'Approval',
          secondaryLabel: 'CCU',
          deltaLabel: '24H',
          showTrend: true,
        },
      }
    }

    if (gamesView === 'Gainers') {
      return {
        rows: topGainerRows,
        props: {
          primaryLabel: 'Approval',
          secondaryLabel: 'CCU',
          deltaLabel: '24H',
          showTrend: true,
        },
      }
    }

    if (gamesView === 'Losers') {
      return {
        rows: topLoserRows,
        props: {
          primaryLabel: 'Approval',
          secondaryLabel: 'CCU',
          deltaLabel: '24H',
          showTrend: true,
        },
      }
    }

    if (gamesView === 'Breakouts') {
      return {
        rows: breakoutRows,
        props: {
          primaryLabel: 'Approval',
          secondaryLabel: 'CCU',
          deltaLabel: '24H',
          showTrend: true,
        },
      }
    }

    return {
      rows: topGamesRows,
        props: {
          primaryLabel: 'Approval',
          secondaryLabel: 'CCU',
          deltaLabel: '24H',
          showTrend: true,
          showRank: true,
        },
    }
  }, [breakoutRows, gamesView, topGainerRows, topGamesRows, topLoserRows, trendingRows])

  const visibleTableRows = useMemo(
    () => tableConfig.rows.slice(0, visibleTableRowCount),
    [tableConfig.rows, visibleTableRowCount],
  )
  const hasMoreTableRows = visibleTableRowCount < tableConfig.rows.length

  useEffect(() => {
    const sentinel = tableLoadMoreRef.current

    if (!sentinel || !hasMoreTableRows) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }

        setVisibleTableRowCount((current) =>
          Math.min(current + HOME_TABLE_BATCH_SIZE, tableConfig.rows.length),
        )
      },
      {
        root: null,
        rootMargin: '320px 0px',
        threshold: 0,
      },
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  }, [hasMoreTableRows, tableConfig.rows.length])

  return (
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
            gap: TOKENS.spacing.xxl,
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: TOKENS.spacing.lg,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: TOKENS.spacing.md,
                alignItems: 'flex-start',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gap: TOKENS.spacing.xs,
                  minWidth: 'min(100%, 420px)',
                  flex: '1 1 420px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      color: TOKENS.colors.neutral1,
                      fontSize: TOKENS.typography.heading2.size,
                      lineHeight: TOKENS.typography.heading2.lineHeight,
                      fontWeight: TOKENS.typography.heading2.weight,
                      letterSpacing: TOKENS.typography.heading2.letterSpacing,
                    }}
                  >
                    Roblox market pulse
                  </span>
                </div>

                <div
                  style={{
                    color: TOKENS.colors.neutral3,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  Search moved to the left rail. The board below loads {Math.min(HOME_TABLE_BATCH_SIZE, topLeaderboard.length)} games first, then keeps adding more as you scroll.
                </div>
              </div>

              <SegmentedControl
                options={['Live', '1D', '1W', '1M'] as const}
                value={heroRange}
                onChange={setHeroRange}
              />
            </div>

            <div className="home-overview-hero-grid">
              <LiveMetricHero
                label="Total Players"
                labelStyle={TOKENS.typography.body2}
                value={heroMetricValue}
                subtitle={platformHistoryNote}
                points={[]}
                tone={livePlatform?.tone ?? 'neutral'}
                chartColor={TOKENS.colors.base}
                chartHeight={280}
                loading={isHeroChartLoading}
                chart={
                  <LiveLineChart
                    data={platformHeroChartData}
                    window={platformChartWindowSeconds}
                    tone={livePlatform?.tone ?? 'neutral'}
                    color={TOKENS.colors.base}
                    height={280}
                    loading={isHeroChartLoading}
                  />
                }
              />

              <LiveMetricHero
                label="Top 3 Players"
                labelStyle={TOKENS.typography.body2}
                value={<WholeNumber value={topThreeTotalValue} flashOnChange />}
                labelTrailing={topThreeLegend}
                points={[]}
                tone="neutral"
                chartHeight={280}
                chart={
                  <TopFiveLiveSeriesChart
                    games={topThreeLeaderboard}
                    timelineByUniverseId={topFiveTimelineByUniverseId}
                    windowSeconds={
                      heroRange === 'Live'
                        ? topFiveWindow.secs
                        : historicalBoardWindowSeconds
                    }
                    mode={heroRange === 'Live' ? 'live' : 'history'}
                    height={280}
                    loading={isBoardLoading && topThreeLeaderboard.length === 0}
                    hiddenUniverseIds={activeHiddenTopThreeIds}
                  />
                }
              />
            </div>
          </div>

          <div className="home-overview-grid">
            <div
              style={{
                display: 'grid',
                gap: TOKENS.spacing.md,
                gridColumn: '1 / -1',
              }}
            >
              <UnderlineTabs
                options={
                  ['Top Games', 'Trending', 'Gainers', 'Losers', 'Breakouts'] as const
                }
                value={gamesView}
                onChange={handleGamesViewChange}
              />

              <div
                style={{
                  color: TOKENS.colors.neutral3,
                  fontSize: TOKENS.typography.body3.size,
                  lineHeight: TOKENS.typography.body3.lineHeight,
                }}
              >
                Showing {visibleTableRows.length} of {tableConfig.rows.length} indexed games on this board view.
              </div>

              <GamesOverviewTable
                variant="compact"
                rows={visibleTableRows}
                loading={isBoardLoading && topLeaderboard.length === 0}
                skeletonRowCount={9}
                onRowClick={(row) => onOpenGame({ universeId: row.universeId, name: row.name })}
                {...tableConfig.props}
              />

              {hasMoreTableRows ? (
                <div
                  ref={tableLoadMoreRef}
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '8px 0 0',
                    color: TOKENS.colors.neutral3,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  Loading more games as you scroll.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
