import { WholeNumber } from '../ui/AnimatedNumber'
import { TOKENS } from '../../design/marketTokens'

type PlayerHeatmapProps = {
  items: Array<{
    hour: number
    averageCCU: number
  }>
  caption?: string
}

export function PlayerHeatmap({
  items,
  caption = 'Last 24 hours of observed CCU by local hour.',
}: PlayerHeatmapProps) {
  const orderedItems = [...items].sort((left, right) => left.hour - right.hour)
  const maxValue = Math.max(...orderedItems.map((item) => item.averageCCU), 1)

  return (
    <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
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
            fontSize: TOKENS.typography.body3.size,
            lineHeight: TOKENS.typography.body3.lineHeight,
          }}
        >
          Hourly intensity
        </span>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: TOKENS.spacing.xs,
            color: TOKENS.colors.neutral2,
            fontSize: TOKENS.typography.body3.size,
            lineHeight: TOKENS.typography.body3.lineHeight,
          }}
        >
          <span>Lower</span>
          <span
            aria-hidden="true"
            style={{
              width: '72px',
              height: '10px',
              borderRadius: TOKENS.radii.pill,
              border: `1px solid ${TOKENS.colors.surface3}`,
              background:
                'linear-gradient(90deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.5) 100%)',
            }}
          />
          <span>Higher</span>
        </div>
      </div>

      <div
        style={{
          overflowX: 'auto',
          paddingBottom: TOKENS.spacing.xs,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gap: TOKENS.spacing.sm,
            minWidth: '720px',
          }}
        >
          {orderedItems.map((item) => {
            const intensity = Math.max(item.averageCCU / maxValue, 0.12)

            return (
              <div
                key={item.hour}
                style={{
                  display: 'grid',
                  gap: TOKENS.spacing.xxs,
                  padding: TOKENS.spacing.md,
                  borderRadius: TOKENS.radii.xl,
                  border: `1px solid ${TOKENS.colors.surface3}`,
                  background: `rgba(255, 255, 255, ${0.08 + intensity * 0.26})`,
                  minHeight: '96px',
                  alignContent: 'space-between',
                }}
              >
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body3.size,
                    lineHeight: TOKENS.typography.body3.lineHeight,
                  }}
                >
                  {item.hour.toString().padStart(2, '0')}:00
                </div>
                <div
                  style={{
                    color: TOKENS.colors.neutral1,
                    fontSize: TOKENS.typography.heading3.size,
                    lineHeight: TOKENS.typography.heading3.lineHeight,
                    fontWeight: TOKENS.typography.heading3.weight,
                  }}
                >
                  <WholeNumber value={item.averageCCU} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div
        style={{
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body3.size,
          lineHeight: TOKENS.typography.body3.lineHeight,
        }}
      >
        {caption}
      </div>
    </div>
  )
}
