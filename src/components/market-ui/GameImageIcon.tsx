import { useMemo, useState, type CSSProperties } from 'react'

import { TOKENS } from '../../design/marketTokens'
import { Skeleton } from './Skeleton'

type GameImageIconProps = {
  label: string
  size?: number
  imageUrl?: string | null
  universeId?: number | null
  background?: string
  borderRadius?: string
  style?: CSSProperties
}

function toMonogram(label: string) {
  const words = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (words.length === 0) {
    return '?'
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  return words.map((word) => word[0]?.toUpperCase() ?? '').join('')
}

export function GameImageIcon({
  label,
  size = 48,
  imageUrl,
  universeId,
  background = TOKENS.colors.surface2,
  borderRadius = '25%',
  style,
}: GameImageIconProps) {
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const normalizedUniverseId =
    typeof universeId === 'number' && Number.isFinite(universeId) && universeId > 0
      ? universeId
      : null
  const trimmedImageUrl = imageUrl?.trim() ? imageUrl.trim() : null

  const retryUrl =
    retryNonce > 0 && normalizedUniverseId != null
      ? `/api/game-icon/${normalizedUniverseId}?refresh=${retryNonce}`
      : null
  const activeImageUrl =
    retryUrl ??
    trimmedImageUrl ??
    (normalizedUniverseId != null ? `/api/game-icon/${normalizedUniverseId}` : null)
  const showImage =
    Boolean(activeImageUrl) &&
    loadedImageUrl === activeImageUrl &&
    failedImageUrl !== activeImageUrl
  const showLoadingState =
    Boolean(activeImageUrl) &&
    loadedImageUrl !== activeImageUrl &&
    failedImageUrl !== activeImageUrl
  const monogram = useMemo(() => toMonogram(label), [label])

  return (
    <div
      className="market-glass-frame"
      aria-label={label}
      title={label}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: TOKENS.colors.neutral1,
        fontSize: `${Math.max(size * 0.28, 11)}px`,
        fontWeight: 650,
        letterSpacing: '-0.03em',
        flexShrink: 0,
        overflow: 'hidden',
        ...style,
      }}
    >
      {activeImageUrl && failedImageUrl !== activeImageUrl ? (
        <img
          src={activeImageUrl}
          alt=""
          onLoad={() => setLoadedImageUrl(activeImageUrl)}
          onError={() => {
            if (retryNonce === 0 && normalizedUniverseId != null && trimmedImageUrl != null) {
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

      {showLoadingState ? (
        <Skeleton
          width="100%"
          height="100%"
          radius={borderRadius}
        />
      ) : null}

      {!showImage && !showLoadingState ? (
        <div
          aria-hidden="true"
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            background:
              'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 28%, rgba(0,0,0,0) 55%), linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
          }}
        >
          <span style={{ opacity: 0.92 }}>{monogram}</span>
        </div>
      ) : null}
    </div>
  )
}
