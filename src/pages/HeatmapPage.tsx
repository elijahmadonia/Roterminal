import { useMemo } from 'react'

import { CategoryPerformanceMap } from '../components/market-ui/CategoryPerformanceMap'
import {
  CompactNumber,
  PercentNumber,
} from '../components/ui/AnimatedNumber'
import { TOKENS } from '../design/marketTokens'
import { useLiveBoard } from '../hooks/useLiveBoard'

type HeatmapPageProps = {
  onOpenGame: (game: { universeId?: number; name: string }) => void
}

export default function HeatmapPage({ onOpenGame }: HeatmapPageProps) {
  const {
    data: liveBoard,
    error,
    isLoading,
  } = useLiveBoard('24h')

  const leaderboardByUniverseId = useMemo(
    () =>
      new Map(
        (liveBoard?.leaderboard ?? []).map((game) => [game.universeId, game]),
      ),
    [liveBoard?.leaderboard],
  )

  const heatmapSections = useMemo(
    () =>
      (liveBoard?.genreHeatmap ?? []).slice(0, 10).map((bucket, sectionIndex) => ({
        id: bucket.name,
        title: bucket.name,
        span: (sectionIndex < 2 ? 6 : sectionIndex < 5 ? 4 : 3) as 3 | 4 | 6,
        items: bucket.experiences.slice(0, sectionIndex < 2 ? 10 : 8).map((entry) => {
          const game = entry.universeId != null
            ? leaderboardByUniverseId.get(entry.universeId)
            : undefined

          return {
            id: entry.universeId ?? entry.name,
            title: entry.name,
            value: <PercentNumber value={entry.change} signed />,
            subtitle: (
              <>
                <CompactNumber value={entry.weight} flashOnChange /> CCU
              </>
            ),
            change: entry.change,
            weight: Math.max(entry.weight, 1),
            imageUrl: game?.thumbnailUrl,
            tone: entry.tone,
          }
        }),
      })),
    [leaderboardByUniverseId, liveBoard?.genreHeatmap],
  )

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
          gap: TOKENS.spacing.lg,
        }}
      >
        <CategoryPerformanceMap
          sections={heatmapSections}
          loading={isLoading && heatmapSections.length === 0}
          onItemClick={(item) =>
            onOpenGame({
              universeId: typeof item.id === 'number' ? item.id : undefined,
              name: item.title,
            })}
        />

        {error && !liveBoard ? (
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
            }}
          >
            {error}
          </div>
        ) : null}
      </main>
    </div>
  )
}
