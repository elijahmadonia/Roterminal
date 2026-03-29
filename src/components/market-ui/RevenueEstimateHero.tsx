import { useState } from 'react'

import { liveRevenueEstimate } from '../../data/homeOverview'
import { TOKENS } from '../../design/marketTokens'
import { AnimatedNumber } from '../ui/AnimatedNumber'
import { LiveBarChart } from './LiveBarChart'
import { LiveMetricHero } from './LiveMetricHero'
import { SegmentedControl } from './SegmentedControl'

type RevenueRange = keyof typeof liveRevenueEstimate.ranges

type RevenueEstimateHeroProps = {
  range?: RevenueRange
  onChangeRange?: (range: RevenueRange) => void
  chartHeight?: number
}

export function RevenueEstimateHero({
  range,
  onChangeRange,
  chartHeight = 280,
}: RevenueEstimateHeroProps) {
  const [internalRange, setInternalRange] = useState<RevenueRange>('1D')
  const [activeValue, setActiveValue] = useState<number | null>(null)
  const resolvedRange = range ?? internalRange
  const setRange = onChangeRange ?? setInternalRange
  const displayValue = activeValue ?? liveRevenueEstimate.ranges[resolvedRange].at(-1) ?? null

  return (
    <LiveMetricHero
      label="Estimated Daily Revenue"
      labelStyle={TOKENS.typography.body2}
      value={
        <AnimatedNumber
          value={displayValue == null ? null : displayValue * 1_000_000}
          format={{
            style: 'currency',
            currency: 'USD',
            notation: 'compact',
            maximumFractionDigits: 1,
          }}
        />
      }
      headerTrailing={
        <SegmentedControl
          options={['1D', '1W', '1M'] as const}
          value={resolvedRange}
          onChange={setRange}
        />
      }
      points={liveRevenueEstimate.ranges[resolvedRange]}
      tone={liveRevenueEstimate.tone}
      chartHeight={chartHeight}
      chart={
        <LiveBarChart
          values={liveRevenueEstimate.ranges[resolvedRange]}
          labels={liveRevenueEstimate.labels[resolvedRange]}
          color={TOKENS.colors.accent1}
          height={chartHeight}
          formatValue={(value) => `$${value.toFixed(1)}M`}
          onActiveChange={({ value }) => setActiveValue(value)}
        />
      }
    />
  )
}
