import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  hierarchy,
  treemap,
  treemapSquarify,
} from 'd3-hierarchy'

import { TOKENS } from '../../design/marketTokens'
import { Skeleton } from './Skeleton'

export type CategoryPerformanceMapItem = {
  id: string | number
  title: string
  value: ReactNode
  subtitle?: ReactNode
  change?: number
  weight: number
  imageUrl?: string
  tone?: 'positive' | 'negative' | 'neutral'
}

export type CategoryPerformanceMapSection = {
  id: string
  title: string
  items: CategoryPerformanceMapItem[]
  span?: 3 | 4 | 6 | 12
}

type CategoryPerformanceMapProps = {
  sections: CategoryPerformanceMapSection[]
  loading?: boolean
  onItemClick?: (item: CategoryPerformanceMapItem) => void
}

type LayoutLeaf = CategoryPerformanceMapItem & {
  x0: number
  y0: number
  x1: number
  y1: number
}

type SectionLayout = CategoryPerformanceMapSection & {
  weight: number
  x0: number
  y0: number
  x1: number
  y1: number
}

type TreemapDataNode = CategoryPerformanceMapItem & {
  children?: TreemapDataNode[]
}

type TreemapSectionNode = CategoryPerformanceMapSection & {
  weight: number
  children?: TreemapSectionNode[]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function mixHex(start: string, end: string, amount: number) {
  const safe = clamp(amount, 0, 1)
  const from = start.replace('#', '')
  const to = end.replace('#', '')
  const channels = [0, 2, 4].map((index) => {
    const startChannel = Number.parseInt(from.slice(index, index + 2), 16)
    const endChannel = Number.parseInt(to.slice(index, index + 2), 16)
    return Math.round(startChannel + (endChannel - startChannel) * safe)
      .toString(16)
      .padStart(2, '0')
  })

  return `#${channels.join('')}`
}

function tileColor(change = 0, tone: CategoryPerformanceMapItem['tone']) {
  if (tone === 'positive') {
    return mixHex('#173425', '#21C95E', clamp(Math.abs(change) / 20, 0.18, 1))
  }

  if (tone === 'negative') {
    return mixHex('#341B17', TOKENS.colors.critical, clamp(Math.abs(change) / 20, 0.18, 1))
  }

  return mixHex(TOKENS.colors.surface4, TOKENS.colors.surface2, clamp(Math.abs(change) / 20, 0.18, 1))
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const update = () => {
      setWidth(node.getBoundingClientRect().width)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

function CategoryTile({
  item,
  onClick,
}: {
  item: LayoutLeaf
  onClick?: () => void
}) {
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const width = Math.max(item.x1 - item.x0, 0)
  const height = Math.max(item.y1 - item.y0, 0)
  const area = width * height
  const large = area > 12000
  const medium = area > 5200
  const small = area > 2200
  const showIcon = area > 700 && Boolean(item.imageUrl)
  const showTitle = area > 1200
  const showValue = area > 1700
  const imageSize = Math.max(
    18,
    Math.min(
      large ? 64 : medium ? 46 : small ? 32 : 24,
      Math.floor(Math.min(width, height) * (large ? 0.28 : 0.24)),
    ),
  )
  const titleMaxChars = large ? 18 : medium ? 14 : small ? 10 : 0
  const titleLabel =
    showTitle && titleMaxChars > 0 && item.title.length > titleMaxChars
      ? `${item.title.slice(0, titleMaxChars)}…`
      : item.title
  const universeId = Number(item.id)
  const retryUrl =
    retryNonce > 0 && Number.isFinite(universeId) && universeId > 0
      ? `/api/game-icon/${universeId}?refresh=${retryNonce}`
      : null
  const activeImageUrl =
    retryUrl ??
    item.imageUrl ??
    (Number.isFinite(universeId) && universeId > 0 ? `/api/game-icon/${universeId}` : null)
  const showLoadedImage =
    Boolean(activeImageUrl) &&
    loadedImageUrl === activeImageUrl &&
    failedImageUrl !== activeImageUrl

  return (
    <button
      type="button"
      onClick={onClick}
      title={item.title}
      style={{
        position: 'absolute',
        left: `${item.x0}px`,
        top: `${item.y0}px`,
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: '10px',
        background: tileColor(item.change, item.tone),
        padding: large ? '14px' : medium ? '10px' : small ? '8px' : '4px',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.08) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%',
          display: 'grid',
          justifyItems: 'center',
          alignContent: 'center',
          gap: large ? '8px' : medium ? '6px' : '4px',
        }}
      >
        {showIcon ? (
          <div
            className="market-glass-frame"
            style={{
              width: `${imageSize}px`,
              height: `${imageSize}px`,
              borderRadius: '25%',
              overflow: 'hidden',
              background: 'rgba(0,0,0,0.22)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            {activeImageUrl && failedImageUrl !== activeImageUrl ? (
              <img
                src={activeImageUrl}
                alt=""
                onLoad={() => setLoadedImageUrl(activeImageUrl)}
                onError={() => {
                  if (retryNonce === 0 && Number.isFinite(universeId) && universeId > 0 && item.imageUrl) {
                    setRetryNonce(Date.now())
                    return
                  }

                  setFailedImageUrl(activeImageUrl)
                }}
                className="market-glass-image"
                style={{
                  display: showLoadedImage ? 'block' : 'none',
                }}
              />
            ) : null}
            {!showLoadedImage ? (
              <Skeleton
                width="100%"
                height="100%"
                radius={`${Math.round(imageSize * 0.25)}px`}
              />
            ) : null}
          </div>
        ) : null}

        {showTitle ? (
          <span
            style={{
              maxWidth: '100%',
              color: TOKENS.colors.neutral1,
              fontSize: large ? '14px' : medium ? '12px' : '10px',
              lineHeight: large ? '18px' : medium ? '15px' : '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {titleLabel}
          </span>
        ) : null}

        {showValue ? (
          <span
            style={{
              color: TOKENS.colors.neutral1,
              fontSize: large ? '14px' : medium ? '12px' : '10px',
              lineHeight: large ? '18px' : medium ? '15px' : '12px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {item.value}
          </span>
        ) : null}

      </div>
    </button>
  )
}

function CategorySection({
  section,
  width,
  height,
  onItemClick,
}: {
  section: CategoryPerformanceMapSection
  width: number
  height: number
  onItemClick?: (item: CategoryPerformanceMapItem) => void
}) {
  const titleHeight = 20
  const contentTop = titleHeight + 8
  const contentHeight = Math.max(height - contentTop, 0)

  const leaves = useMemo<LayoutLeaf[]>(() => {
    if (width <= 0 || contentHeight <= 0 || section.items.length === 0) return []

    const rootData: TreemapDataNode = {
      id: `root-${section.id}`,
      title: '',
      value: '',
      weight: 0,
      children: section.items.map((item) => ({
        ...item,
        weight: Math.max(item.weight, 1),
      })),
    }

    const root = hierarchy(rootData)
      .sum((node) => node.weight ?? 0)
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))

    const layout = treemap<TreemapDataNode>()
      .tile(treemapSquarify.ratio(1))
      .size([width, contentHeight])
      .round(true)
      .paddingInner(4)
      .paddingOuter(0)

    const laidOutRoot = layout(root)

    return laidOutRoot.leaves().map((leaf) => ({
      ...leaf.data,
      x0: leaf.x0,
      y0: leaf.y0,
      x1: leaf.x1,
      y1: leaf.y1,
    }))
  }, [contentHeight, section.id, section.items, width])

  const sectionArea = width * height
  const showSectionTitle = sectionArea > 6000

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {showSectionTitle ? (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: TOKENS.colors.neutral2,
            fontSize: TOKENS.typography.body2.size,
            lineHeight: TOKENS.typography.body2.lineHeight,
            fontWeight: 500,
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span>{section.title}</span>
          <span aria-hidden="true">›</span>
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 0,
          top: `${contentTop}px`,
          width: `${width}px`,
          height: `${contentHeight}px`,
        }}
      >
        {leaves.map((item) => (
          <CategoryTile
            key={item.id}
            item={item}
            onClick={onItemClick ? () => onItemClick(item) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function CategorySectionSkeleton({
  width,
  height,
}: {
  width: number
  height: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      <Skeleton width="120px" height="16px" radius="6px" />
      <Skeleton
        width="100%"
        height={`${Math.max(height - 28, 0)}px`}
        radius="14px"
        style={{ position: 'absolute', left: 0, top: '28px' }}
      />
    </div>
  )
}

export function CategoryPerformanceMap({
  sections,
  loading = false,
  onItemClick,
}: CategoryPerformanceMapProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const height = clamp(width * 0.58, 420, 720)

  const sectionLayouts = useMemo<SectionLayout[]>(() => {
    if (width <= 0 || sections.length === 0) return []

    const rootData: TreemapSectionNode = {
      id: 'root',
      title: '',
      items: [],
      weight: 0,
      children: sections.map((section) => ({
        ...section,
        weight: Math.max(
          section.items.reduce((sum, item) => sum + item.weight, 0),
          1,
        ),
      })),
    }

    const laidOutRoot = treemap<TreemapSectionNode>()
      .tile(treemapSquarify.ratio(1.1))
      .size([width, height])
      .round(true)
      .paddingInner(14)
      .paddingOuter(0)(
        hierarchy(rootData)
          .sum((node) => node.weight ?? 0)
          .sort((left, right) => (right.value ?? 0) - (left.value ?? 0)),
      )

    return laidOutRoot.leaves().map((leaf) => ({
      ...leaf.data,
      x0: leaf.x0,
      y0: leaf.y0,
      x1: leaf.x1,
      y1: leaf.y1,
    }))
  }, [height, sections, width])

  if (loading && sections.length === 0) {
    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: '100%',
          height: `${height}px`,
        }}
      >
        {width > 0 ? (
          <>
            <div style={{ position: 'absolute', left: 0, top: 0, width: `${width * 0.58}px`, height: `${height * 0.52}px` }}>
              <CategorySectionSkeleton width={width * 0.58} height={height * 0.52} />
            </div>
            <div style={{ position: 'absolute', left: `${width * 0.6}px`, top: 0, width: `${width * 0.4}px`, height: `${height * 0.34}px` }}>
              <CategorySectionSkeleton width={width * 0.4} height={height * 0.34} />
            </div>
            <div style={{ position: 'absolute', left: `${width * 0.6}px`, top: `${height * 0.38}px`, width: `${width * 0.4}px`, height: `${height * 0.24}px` }}>
              <CategorySectionSkeleton width={width * 0.4} height={height * 0.24} />
            </div>
            <div style={{ position: 'absolute', left: 0, top: `${height * 0.56}px`, width: `${width * 0.36}px`, height: `${height * 0.24}px` }}>
              <CategorySectionSkeleton width={width * 0.36} height={height * 0.24} />
            </div>
            <div style={{ position: 'absolute', left: `${width * 0.38}px`, top: `${height * 0.56}px`, width: `${width * 0.28}px`, height: `${height * 0.22}px` }}>
              <CategorySectionSkeleton width={width * 0.28} height={height * 0.22} />
            </div>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
      }}
    >
      {sectionLayouts.map((section) => (
        <div
          key={section.id}
          style={{
            position: 'absolute',
            left: `${section.x0}px`,
            top: `${section.y0}px`,
            width: `${Math.max(section.x1 - section.x0, 0)}px`,
            height: `${Math.max(section.y1 - section.y0, 0)}px`,
          }}
        >
          <CategorySection
            section={section}
            width={Math.max(section.x1 - section.x0, 0)}
            height={Math.max(section.y1 - section.y0, 0)}
            onItemClick={onItemClick}
          />
        </div>
      ))}
    </div>
  )
}
