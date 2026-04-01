import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { CategoryPerformanceMap } from '../components/market-ui/CategoryPerformanceMap'
import { SurfacePanel } from '../components/market-ui/SurfacePanel'
import {
  CompactNumber,
  PercentNumber,
  WholeNumber,
} from '../components/ui/AnimatedNumber'
import { TOKENS } from '../design/marketTokens'
import { useLiveBoard } from '../hooks/useLiveBoard'

type HeatmapPageProps = {
  onOpenGame: (game: { universeId?: number; name: string }) => void
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail: string
}) {
  return (
    <SurfacePanel style={{ gap: TOKENS.spacing.sm }}>
      <div
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body3.size,
          lineHeight: TOKENS.typography.body3.lineHeight,
        }}
      >
        {label}
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
        {value}
      </div>
      <div
        style={{
          color: TOKENS.colors.neutral3,
          fontSize: TOKENS.typography.body3.size,
          lineHeight: TOKENS.typography.body3.lineHeight,
        }}
      >
        {detail}
      </div>
    </SurfacePanel>
  )
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

  const totalBuckets = liveBoard?.genreHeatmap.length ?? 0
  const totalExperiences = useMemo(
    () =>
      (liveBoard?.genreHeatmap ?? []).reduce(
        (sum, bucket) => sum + bucket.experiences.length,
        0,
      ),
    [liveBoard?.genreHeatmap],
  )
  const leadingBucket = liveBoard?.genreHeatmap[0] ?? null

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
            gap: TOKENS.spacing.lg,
            paddingBottom: TOKENS.spacing.xl,
            borderBottom: `1px solid ${TOKENS.colors.surface3}`,
          }}
        >
          <div style={{ display: 'grid', gap: TOKENS.spacing.xs }}>
            <h1
              style={{
                margin: 0,
                fontSize: TOKENS.typography.heading1.size,
                lineHeight: TOKENS.typography.heading1.lineHeight,
                fontWeight: TOKENS.typography.heading1.weight,
                letterSpacing: TOKENS.typography.heading1.letterSpacing,
              }}
            >
              Heatmap
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: '760px',
                color: TOKENS.colors.neutral2,
                fontSize: TOKENS.typography.body1.size,
                lineHeight: TOKENS.typography.body1.lineHeight,
              }}
            >
              Market-wide genre heatmap built from the live board. Click any tile to open the
              experience behind it.
            </p>
          </div>

          {error && !liveBoard ? (
            <SurfacePanel title="Unable to load heatmap">
              <div
                style={{
                  color: TOKENS.colors.neutral2,
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                }}
              >
                {error}
              </div>
            </SurfacePanel>
          ) : null}
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.lg,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <StatTile
            label="Genres tracked"
            value={<WholeNumber value={totalBuckets} />}
            detail="Distinct genre buckets represented in the current board snapshot."
          />
          <StatTile
            label="Experiences surfaced"
            value={<WholeNumber value={totalExperiences} />}
            detail="Tiles currently rendered across the market heatmap."
          />
          <StatTile
            label="Leading genre"
            value={leadingBucket?.name ?? 'Unavailable'}
            detail={leadingBucket?.ccuLabel ?? 'Waiting for live board data.'}
          />
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.md,
          }}
        >
          <div
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.body2.size,
              lineHeight: TOKENS.typography.body2.lineHeight,
            }}
          >
            Tile color reflects weekly change. Tile area reflects live audience size.
          </div>

          <CategoryPerformanceMap
            sections={heatmapSections}
            loading={isLoading && heatmapSections.length === 0}
            onItemClick={(item) =>
              onOpenGame({
                universeId: typeof item.id === 'number' ? item.id : undefined,
                name: item.title,
              })}
          />
        </section>
      </main>
    </div>
  )
}
