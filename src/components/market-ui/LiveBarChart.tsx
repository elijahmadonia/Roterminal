import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { TOKENS } from '../../design/marketTokens'

const CHART_PADDING = {
  top: 12,
  right: 54,
  bottom: 28,
  left: 12,
} as const

const AXIS_COLORS = {
  gridLine: 'rgba(255, 255, 255, 0.06)',
  gridLabel: 'rgba(255, 255, 255, 0.58)',
  timeLabel: 'rgba(255, 255, 255, 0.52)',
} as const

const AXIS_FONT = '12px "SF Mono", Menlo, Monaco, "Cascadia Code", monospace'

type LiveBarChartProps = {
  values: number[]
  labels?: string[]
  color?: string
  height?: number
  formatValue?: (value: number) => string
  onActiveChange?: (active: { index: number | null; value: number | null; label: string | null }) => void
}

export function LiveBarChart({
  values,
  labels,
  color = TOKENS.colors.accent1,
  height = 280,
  formatValue = (value) => `$${value.toFixed(1)}M`,
  onActiveChange,
}: LiveBarChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const max = Math.max(...values, 1)
  const tickRatios = useMemo(() => [1, 0.75, 0.5, 0.25], [])
  const tickValues = useMemo(
    () => tickRatios.map((ratio) => formatValue(max * ratio)),
    [formatValue, max, tickRatios],
  )
  const xLabelIndexes = useMemo(() => {
    const candidates = [0, Math.floor(values.length * 0.25), Math.floor(values.length * 0.5), Math.floor(values.length * 0.75), values.length - 1]
    return [...new Set(candidates)].filter((index) => index >= 0 && index < values.length)
  }, [values.length])

  if (values.length === 0) {
    return null
  }

  const chartSurfaceStyle: CSSProperties & Record<'--chart-surface-inset', string> = {
    width: '100%',
    height,
    position: 'relative',
    '--chart-surface-inset': `${CHART_PADDING.top}px ${CHART_PADDING.right}px ${CHART_PADDING.bottom}px ${CHART_PADDING.left}px`,
  }

  const setActive = (index: number | null) => {
    setActiveIndex(index)
    onActiveChange?.({
      index,
      value: index === null ? null : values[index],
      label: index === null ? null : labels?.[index] ?? `Point ${index + 1}`,
    })
  }

  return (
    <div
      className="chart-dotted-surface chart-dotted-surface--bar"
      style={{
        ...chartSurfaceStyle,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height,
          overflow: 'hidden',
        }}
      >
        {tickRatios.map((ratio, index) => {
          const y = CHART_PADDING.top + index * ((height - CHART_PADDING.top - CHART_PADDING.bottom) / (tickRatios.length - 1))

          return (
          <div
            key={`bar-grid-${ratio}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${CHART_PADDING.left}px`,
              right: `${CHART_PADDING.right}px`,
              top: `${y}px`,
              borderTop: `1px dashed ${AXIS_COLORS.gridLine}`,
              pointerEvents: 'none',
            }}
          />
          )
        })}

        <div
          style={{
            position: 'absolute',
            inset: `${CHART_PADDING.top}px ${CHART_PADDING.right}px ${CHART_PADDING.bottom}px ${CHART_PADDING.left}px`,
            display: 'flex',
            alignItems: 'flex-end',
            gap: '4px',
          }}
        >
          {values.map((value, index) => {
            const ratio = Math.max(value / max, 0.06)
            const active = activeIndex === index
            const dimOthers = activeIndex !== null && activeIndex !== index

            return (
              <div
                key={`${index}-${value}`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                style={{
                  position: 'relative',
                  flex: 1,
                  height: `${ratio * 100}%`,
                  minWidth: 0,
                  cursor: 'pointer',
                }}
              >
                {active ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      top: `-${height}px`,
                      height: `calc(100% + ${height}px)`,
                      borderRadius: '3px',
                      background: 'rgba(255,255,255,0.08)',
                      pointerEvents: 'none',
                    }}
                  />
                ) : null}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderTopLeftRadius: '2px',
                    borderTopRightRadius: '2px',
                    background: color,
                    boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 18%, transparent) inset`,
                    opacity: dimOthers ? 0.35 : 1,
                    transition: `opacity ${TOKENS.transitions.fast}, background ${TOKENS.transitions.fast}`,
                  }}
                />
              </div>
            )
          })}
        </div>

        <div
          style={{
            position: 'absolute',
            top: `${CHART_PADDING.top - 7}px`,
            right: 0,
            bottom: `${CHART_PADDING.bottom}px`,
            width: `${CHART_PADDING.right}px`,
            display: 'grid',
            alignContent: 'space-between',
            justifyItems: 'end',
            color: AXIS_COLORS.gridLabel,
            fontSize: '12px',
            lineHeight: '12px',
            fontFamily: AXIS_FONT,
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
          }}
        >
          {tickValues.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>

        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${CHART_PADDING.left}px`,
            right: `${CHART_PADDING.right}px`,
            bottom: `${CHART_PADDING.bottom}px`,
            borderTop: `1px solid ${AXIS_COLORS.gridLine}`,
            pointerEvents: 'none',
          }}
        />

        {xLabelIndexes.map((index) => {
          const leftPercent = values.length === 1 ? 0 : (index / (values.length - 1)) * 100

          return (
            <div
              key={`bar-x-${index}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `calc(${CHART_PADDING.left}px + ((100% - ${CHART_PADDING.left + CHART_PADDING.right}px) * ${leftPercent / 100}))`,
                bottom: `${CHART_PADDING.bottom - 5}px`,
                width: '1px',
                height: '5px',
                background: AXIS_COLORS.gridLine,
                pointerEvents: 'none',
              }}
            />
          )
        })}

        {xLabelIndexes.map((index) => {
          const leftPercent = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
          const align =
            index === xLabelIndexes[0]
              ? 'left'
              : index === xLabelIndexes[xLabelIndexes.length - 1]
                ? 'right'
                : 'center'
          const transform =
            align === 'left'
              ? 'translateX(0)'
              : align === 'right'
                ? 'translateX(-100%)'
                : 'translateX(-50%)'

          return (
            <span
              key={`${index}-${labels?.[index] ?? index}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `calc(${CHART_PADDING.left}px + ((100% - ${CHART_PADDING.left + CHART_PADDING.right}px) * ${leftPercent / 100}))`,
                bottom: 0,
                transform,
                color: AXIS_COLORS.timeLabel,
                fontSize: '12px',
                lineHeight: '16px',
                fontFamily: AXIS_FONT,
                fontVariantNumeric: 'tabular-nums',
                textAlign: align,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {labels?.[index] ?? `P${index + 1}`}
            </span>
          )
        })}
      </div>
    </div>
  )
}
