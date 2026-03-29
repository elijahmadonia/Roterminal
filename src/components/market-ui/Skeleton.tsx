import type { CSSProperties } from 'react'

import { TOKENS } from '../../design/marketTokens'

type SkeletonProps = {
  width?: string
  height?: string
  radius?: string
  style?: CSSProperties
}

export function Skeleton({
  width = '100%',
  height = '20px',
  radius = TOKENS.radii.md,
  style,
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className="market-skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  )
}
