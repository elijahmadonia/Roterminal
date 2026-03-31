import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Breadcrumbs } from '../components/market-ui/Breadcrumbs'
import { MarketButton } from '../components/market-ui/MarketButton'
import { PlayerHeatmap } from '../components/market-ui/PlayerHeatmap'
import { Skeleton } from '../components/market-ui/Skeleton'
import { SurfacePanel } from '../components/market-ui/SurfacePanel'
import {
  AnimatedNumber,
  CompactNumber,
  WholeNumber,
} from '../components/ui/AnimatedNumber'
import { TOKENS } from '../design/marketTokens'
import type {
  DetailPlayerMetrics,
  GameDetailResponse,
} from '../types'

type HeatPageProps = {
  gameDetail: GameDetailResponse | null
  isLoading: boolean
  error: string | null
  onOpenGameDetail: () => void
}

const unavailablePlayers: DetailPlayerMetrics = {
  status: 'unavailable',
  source: 'backend payload',
  note: 'This data has not been returned by the current server payload yet.',
  currentCCU: 0,
  estimatedDAU: null,
  estimatedMAU: null,
  peakCCUObserved: null,
  peakCCU30dObserved: null,
  averageSessionLengthMinutes: null,
  dailyVisitsObserved: null,
  hourlyHeatmap: [],
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
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
          textAlign: 'right',
        }}
      >
        {value}
      </strong>
    </div>
  )
}

function HeatPageSkeleton() {
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
        <div style={{ display: 'grid', gap: TOKENS.spacing.lg }}>
          <Skeleton width="160px" height="18px" radius={TOKENS.radii.sm} />
          <Skeleton width="280px" height="42px" radius={TOKENS.radii.md} />
          <Skeleton width="420px" height="18px" radius={TOKENS.radii.sm} />
        </div>

        <SurfacePanel title="Player heatmap">
          <Skeleton width="100%" height="420px" radius={TOKENS.radii.xxl} />
        </SurfacePanel>

        <div
          style={{
            display: 'grid',
            gap: TOKENS.spacing.lg,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          <SurfacePanel title="Player signals">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton
                  key={`heatpage-signal-skeleton-${index}`}
                  width="100%"
                  height="18px"
                  radius={TOKENS.radii.sm}
                />
              ))}
            </div>
          </SurfacePanel>

          <SurfacePanel title="Peak windows">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton
                  key={`heatpage-peak-skeleton-${index}`}
                  width="100%"
                  height="56px"
                  radius={TOKENS.radii.lg}
                />
              ))}
            </div>
          </SurfacePanel>
        </div>
      </main>
    </div>
  )
}

function formatHourLabel(hour: number) {
  return `${hour.toString().padStart(2, '0')}:00`
}

export default function HeatPage({
  gameDetail,
  isLoading,
  error,
  onOpenGameDetail,
}: HeatPageProps) {
  if (isLoading) {
    return <HeatPageSkeleton />
  }

  if (error || !gameDetail) {
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
          <SurfacePanel title="Unable to load heatpage">
            <div
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
                {error ?? 'Unknown error'}
              </div>
              <div>
                <MarketButton
                  type="button"
                  variant="secondary"
                  leadingIcon={<ArrowLeft size={18} strokeWidth={2.2} />}
                  onClick={onOpenGameDetail}
                >
                  Back to game
                </MarketButton>
              </div>
            </div>
          </SurfacePanel>
        </main>
      </div>
    )
  }

  const players = gameDetail.dataSections?.players ?? unavailablePlayers
  const heatmap = [...players.hourlyHeatmap].sort((left, right) => left.hour - right.hour)
  const peakWindows = [...heatmap]
    .sort((left, right) => right.averageCCU - left.averageCCU)
    .slice(0, 4)
  const peakValue = peakWindows[0]?.averageCCU ?? 0

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
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: TOKENS.spacing.lg,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
              <Breadcrumbs
                items={[
                  {
                    label: gameDetail.game.name,
                    onClick: onOpenGameDetail,
                  },
                  {
                    label: 'Heatpage',
                  },
                ]}
              />
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
                  Heatpage
                </h1>
                <p
                  style={{
                    margin: 0,
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body1.size,
                    lineHeight: TOKENS.typography.body1.lineHeight,
                    maxWidth: '720px',
                  }}
                >
                  Hour-by-hour player density for {gameDetail.game.name}, based on the latest
                  observed CCU window.
                </p>
              </div>
            </div>

            <MarketButton
              type="button"
              variant="secondary"
              leadingIcon={<ArrowLeft size={18} strokeWidth={2.2} />}
              onClick={onOpenGameDetail}
            >
              Game detail
            </MarketButton>
          </div>
        </section>

        <section>
          <SurfacePanel title="Player heatmap">
            {heatmap.length === 0 ? (
              <div
                style={{
                  color: TOKENS.colors.neutral2,
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                }}
              >
                No hourly player pattern data returned.
              </div>
            ) : (
              <PlayerHeatmap items={heatmap} caption={players.note || undefined} />
            )}
          </SurfacePanel>
        </section>

        <section
          style={{
            display: 'grid',
            gap: TOKENS.spacing.lg,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          <SurfacePanel title="Player signals">
            <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
              <StatRow label="Current CCU" value={<CompactNumber value={players.currentCCU} />} />
              <StatRow
                label="Observed peak"
                value={
                  players.peakCCUObserved == null
                    ? 'Unavailable'
                    : <WholeNumber value={players.peakCCUObserved} />
                }
              />
              <StatRow
                label="Observed peak 30d"
                value={
                  players.peakCCU30dObserved == null
                    ? 'Unavailable'
                    : <WholeNumber value={players.peakCCU30dObserved} />
                }
              />
              <StatRow
                label="Estimated DAU"
                value={
                  players.estimatedDAU == null
                    ? 'Unavailable'
                    : <CompactNumber value={players.estimatedDAU} />
                }
              />
              <StatRow
                label="Estimated MAU"
                value={
                  players.estimatedMAU == null
                    ? 'Unavailable'
                    : <CompactNumber value={players.estimatedMAU} />
                }
              />
              <StatRow
                label="Daily visits"
                value={
                  players.dailyVisitsObserved == null
                    ? 'Unavailable'
                    : <CompactNumber value={players.dailyVisitsObserved} />
                }
              />
              <StatRow
                label="Avg session length"
                value={
                  players.averageSessionLengthMinutes == null
                    ? 'Unavailable'
                    : (
                        <>
                          <AnimatedNumber
                            value={players.averageSessionLengthMinutes}
                            format={{ maximumFractionDigits: 0 }}
                          /> min
                        </>
                      )
                }
              />
            </div>
          </SurfacePanel>

          <SurfacePanel title="Peak windows">
            {peakWindows.length === 0 ? (
              <div
                style={{
                  color: TOKENS.colors.neutral2,
                  fontSize: TOKENS.typography.body2.size,
                  lineHeight: TOKENS.typography.body2.lineHeight,
                }}
              >
                Peak-hour ranking will appear once the backend returns hourly heatmap data.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
                {peakWindows.map((item, index) => {
                  const shareOfPeak = peakValue > 0 ? item.averageCCU / peakValue : 0

                  return (
                    <div
                      key={`heatpage-peak-${item.hour}`}
                      style={{
                        display: 'grid',
                        gap: TOKENS.spacing.xs,
                        padding: TOKENS.spacing.md,
                        borderRadius: TOKENS.radii.xl,
                        border: `1px solid ${TOKENS.colors.surface3}`,
                        background: TOKENS.colors.surface1,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: TOKENS.spacing.md,
                        }}
                      >
                        <strong
                          style={{
                            fontSize: TOKENS.typography.body1.size,
                            lineHeight: TOKENS.typography.body1.lineHeight,
                            fontWeight: 600,
                          }}
                        >
                          #{index + 1} {formatHourLabel(item.hour)}
                        </strong>
                        <span
                          style={{
                            color: TOKENS.colors.neutral2,
                            fontSize: TOKENS.typography.body3.size,
                            lineHeight: TOKENS.typography.body3.lineHeight,
                          }}
                        >
                          <WholeNumber value={item.averageCCU} />
                        </span>
                      </div>
                      <div
                        aria-hidden="true"
                        style={{
                          width: '100%',
                          height: '8px',
                          borderRadius: TOKENS.radii.pill,
                          background: TOKENS.colors.surface3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.max(shareOfPeak * 100, 8)}%`,
                            height: '100%',
                            borderRadius: TOKENS.radii.pill,
                            background: TOKENS.colors.base,
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SurfacePanel>
        </section>
      </main>
    </div>
  )
}
