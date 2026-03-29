import { TOKENS } from '../design/marketTokens'
import { formatCompactNumber } from './formatters'

type GameShareCardInput = {
  gameName: string
  creatorName: string
  liveCcu: number
  approval: number
  rankLabel: string
  thumbnailUrl?: string
  backgroundImageUrl?: string
  variant?: 'split' | 'poster'
}

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

async function loadCanvasSafeImage(url?: string) {
  if (!url) {
    return null
  }

  try {
    const response = await fetch(url)

    if (!response.ok) {
      return null
    }

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)

    try {
      return await loadImageFromUrl(objectUrl)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2)

  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.lineTo(x + width - safeRadius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  ctx.lineTo(x + width, y + height - safeRadius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  ctx.lineTo(x + safeRadius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  ctx.lineTo(x, y + safeRadius)
  ctx.quadraticCurveTo(x, y, x + safeRadius, y)
  ctx.closePath()
}

function truncateLabel(label: string, maxLength: number) {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}

function fitTitleLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const words = text.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return ['']
  }

  const lines: string[] = []
  let current = ''
  let usedWordCount = 0

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word

    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
      continue
    }

    if (current) {
      lines.push(current)
      usedWordCount += current.split(/\s+/).filter(Boolean).length
      current = word
    } else {
      lines.push(word)
      usedWordCount += 1
      current = ''
    }

    if (lines.length === maxLines) {
      break
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current)
    usedWordCount += current.split(/\s+/).filter(Boolean).length
  }

  if (lines.length > maxLines) {
    lines.length = maxLines
  }

  const overflowed = usedWordCount < words.length

  if (lines.length === maxLines && overflowed) {
    let last = lines[maxLines - 1]
    const remainingWords = words.slice(usedWordCount)

    if (remainingWords.length > 0) {
      last = `${last} ${remainingWords.join(' ')}`
    }

    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
      last = last.slice(0, -1).trimEnd()
    }

    lines[maxLines - 1] = `${last}…`
  }

  return lines
}

function formatApprovalPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const drawX = x + (width - drawWidth) / 2
  const drawY = y + (height - drawHeight) / 2

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
}

function drawTopBadge(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = TOKENS.colors.neutral1
  ctx.font = `600 40px ${TOKENS.typography.fontFamily}`
  ctx.fillText('roterminal.co', 92, 116)
}

function drawBottomBadge(ctx: CanvasRenderingContext2D, height: number) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.font = `600 36px ${TOKENS.typography.fontFamily}`
  ctx.textAlign = 'left'
  ctx.fillText('roterminal.com', 92, height - 64)
}

function drawMetaRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  approval: string,
  rankLabel: string,
) {
  ctx.font = `600 52px ${TOKENS.typography.fontFamily}`
  ctx.textAlign = 'left'

  const leftText = `★ ${approval}`
  const dividerText = '•'
  const rankText = rankLabel === 'N/A' ? 'Rank N/A' : `Rank ${rankLabel}`
  const gap = 28
  const leftWidth = ctx.measureText(leftText).width
  const dotWidth = ctx.measureText(dividerText).width

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.fillText(leftText, x, y + 4)
  ctx.fillText(dividerText, x + leftWidth + gap, y + 4)
  ctx.fillText(rankText, x + leftWidth + gap + dotWidth + gap, y + 4)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(leftText, x, y)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fillText(dividerText, x + leftWidth + gap, y)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(rankText, x + leftWidth + gap + dotWidth + gap, y)

  const sheenGradient = ctx.createLinearGradient(0, y - 48, 0, y + 10)
  sheenGradient.addColorStop(0, 'rgba(255, 255, 255, 0.28)')
  sheenGradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.08)')
  sheenGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheenGradient
  ctx.fillText(leftText, x, y - 2)
  ctx.fillText(dividerText, x + leftWidth + gap, y - 2)
  ctx.fillText(rankText, x + leftWidth + gap + dotWidth + gap, y - 2)
}

function drawCenteredMetaRow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  approval: string,
  rankLabel: string,
) {
  ctx.font = `600 52px ${TOKENS.typography.fontFamily}`
  ctx.textAlign = 'left'

  const leftText = `★ ${approval}`
  const dividerText = '•'
  const rankText = rankLabel === 'N/A' ? 'Rank N/A' : `Rank ${rankLabel}`
  const gap = 28
  const leftWidth = ctx.measureText(leftText).width
  const dotWidth = ctx.measureText(dividerText).width
  const rankWidth = ctx.measureText(rankText).width
  const totalWidth = leftWidth + gap + dotWidth + gap + rankWidth
  const x = centerX - totalWidth / 2

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.fillText(leftText, x, y + 4)
  ctx.fillText(dividerText, x + leftWidth + gap, y + 4)
  ctx.fillText(rankText, x + leftWidth + gap + dotWidth + gap, y + 4)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(leftText, x, y)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fillText(dividerText, x + leftWidth + gap, y)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(rankText, x + leftWidth + gap + dotWidth + gap, y)

  const sheenGradient = ctx.createLinearGradient(0, y - 52, 0, y + 10)
  sheenGradient.addColorStop(0, 'rgba(255, 255, 255, 0.26)')
  sheenGradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.08)')
  sheenGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheenGradient
  ctx.fillText(leftText, x, y - 2)
  ctx.fillText(dividerText, x + leftWidth + gap, y - 2)
  ctx.fillText(rankText, x + leftWidth + gap + dotWidth + gap, y - 2)
}

function drawFramedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  gameName: string,
  x: number,
  y: number,
  size: number,
  radius: number,
  rotation: number,
  borderColor: string,
) {
  const imageCenterX = x + size / 2
  const imageCenterY = y + size / 2

  ctx.save()
  ctx.translate(imageCenterX + 18, imageCenterY + 54)
  ctx.rotate(rotation)
  roundRect(ctx, -size / 2, -size / 2, size, size, radius)
  ctx.filter = 'blur(58px)'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)'
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(imageCenterX + 10, imageCenterY + 32)
  ctx.rotate(rotation)
  roundRect(ctx, -size / 2, -size / 2, size, size, radius)
  ctx.filter = 'blur(24px)'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(imageCenterX + 2, imageCenterY + 12)
  ctx.rotate(rotation)
  roundRect(ctx, -size / 2, -size / 2, size, size, radius)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(imageCenterX, imageCenterY)
  ctx.rotate(rotation)

  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowBlur = 115
  ctx.shadowOffsetY = 0
  roundRect(ctx, -size / 2, -size / 2, size, size, radius * 1.12)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.lineWidth = 10
  ctx.strokeStyle = borderColor
  roundRect(ctx, -size / 2, -size / 2, size, size, radius * 1.12)
  ctx.stroke()

  roundRect(ctx, -size / 2 + 13, -size / 2 + 13, size - 26, size - 26, radius * 0.9)
  ctx.clip()

  if (image) {
    drawImageCover(ctx, image, -size / 2 + 13, -size / 2 + 13, size - 26, size - 26)
  } else {
    const imageGradient = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2)
    imageGradient.addColorStop(0, `${TOKENS.colors.accent1}AA`)
    imageGradient.addColorStop(1, `${TOKENS.colors.base}AA`)
    ctx.fillStyle = imageGradient
    ctx.fillRect(-size / 2, -size / 2, size, size)
    ctx.fillStyle = TOKENS.colors.neutral1
    ctx.font = `600 ${Math.round(size * 0.22)}px ${TOKENS.typography.fontFamily}`
    ctx.textAlign = 'center'
    ctx.fillText(gameName.slice(0, 1).toUpperCase(), 0, size * 0.07)
    ctx.textAlign = 'left'
  }

  const innerGlow = ctx.createRadialGradient(
    -size * 0.12,
    -size * 0.18,
    size * 0.08,
    0,
    0,
    size * 0.72,
  )
  innerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.34)')
  innerGlow.addColorStop(0.42, 'rgba(255, 255, 255, 0.14)')
  innerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = innerGlow
  ctx.fillRect(-size / 2, -size / 2, size, size)

  const topSheen = ctx.createLinearGradient(0, -size / 2, 0, size / 2)
  topSheen.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
  topSheen.addColorStop(0.28, 'rgba(255, 255, 255, 0.06)')
  topSheen.addColorStop(0.55, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = topSheen
  ctx.fillRect(-size / 2, -size / 2, size, size)
  ctx.restore()
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to render share image.'))
        return
      }

      resolve(blob)
    }, 'image/png')
  })
}

export async function generateGameShareCard({
  gameName,
  creatorName,
  liveCcu,
  approval,
  rankLabel,
  thumbnailUrl,
  backgroundImageUrl,
  variant = 'split',
}: GameShareCardInput) {
  const canvas = document.createElement('canvas')
  const width = 1520
  const height = 1080
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Canvas is unavailable.')
  }

  const backgroundImage = await loadCanvasSafeImage(backgroundImageUrl)
  const image = await loadCanvasSafeImage(thumbnailUrl)
  const isPink = backgroundImageUrl?.includes('pink-grid') ?? false
  const ccuColor = isPink ? TOKENS.colors.accent1 : TOKENS.colors.base

  if (variant === 'poster') {
    ctx.fillStyle = TOKENS.colors.surface1
    ctx.fillRect(0, 0, width, height)

    const centerX = width / 2
    const ccuText = formatCompactNumber(liveCcu)
    const ccuGradient = ctx.createLinearGradient(0, 30, 0, 254)
    ccuGradient.addColorStop(0, '#FF86DC')
    ccuGradient.addColorStop(0.56, '#E810AA')

    ctx.font = `800 332px ${TOKENS.typography.fontFamily}`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.fillText(ccuText, centerX, 276)
    ctx.fillStyle = ccuGradient
    ctx.fillText(ccuText, centerX, 266)

    const imageSize = 478
    drawFramedImage(
      ctx,
      image,
      gameName,
      centerX - imageSize / 2,
      212,
      imageSize,
      118,
      9.82 * (Math.PI / 180),
      '#E810AA',
    )

    ctx.textAlign = 'center'
    ctx.fillStyle = TOKENS.colors.neutral1
    ctx.font = `700 74px ${TOKENS.typography.fontFamily}`
    const titleLines = fitTitleLines(ctx, gameName, 980, 2)
    const titleY = 824
    const titleLineHeight = 78
    titleLines.forEach((line, index) => {
      ctx.fillText(line, centerX, titleY + index * titleLineHeight)
    })

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = `500 52px ${TOKENS.typography.fontFamily}`
    const creatorY = titleY + titleLines.length * titleLineHeight + 24
    ctx.fillText(truncateLabel(creatorName, 34), centerX, creatorY)

    drawCenteredMetaRow(
      ctx,
      centerX,
      creatorY + 72,
      formatApprovalPercent(approval),
      rankLabel,
    )

    drawBottomBadge(ctx, height)

    return canvasToBlob(canvas)
  }

  if (backgroundImage) {
    drawImageCover(ctx, backgroundImage, 0, 0, width, height)
  } else {
    ctx.fillStyle = TOKENS.colors.surface1
    ctx.fillRect(0, 0, width, height)
  }
  drawTopBadge(ctx)

  const contentX = 96
  const imageSize = 432
  const imageX = 930
  const imageY = height / 2 - imageSize / 2
  drawFramedImage(
    ctx,
    image,
    gameName,
    imageX,
    imageY,
    imageSize,
    imageSize * 0.25,
    10 * (Math.PI / 180),
    isPink ? TOKENS.colors.accent1 : TOKENS.colors.base,
  )

  ctx.font = `600 76px ${TOKENS.typography.fontFamily}`
  ctx.textAlign = 'left'
  ctx.fillStyle = TOKENS.colors.neutral1
  const titleLines = fitTitleLines(ctx, gameName, 640, 2)
  const titleY = 414
  const titleLineHeight = 82
  titleLines.forEach((line, index) => {
    ctx.fillText(line, contentX, titleY + index * titleLineHeight)
  })

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.font = `500 50px ${TOKENS.typography.fontFamily}`
  const creatorY = titleY + titleLines.length * titleLineHeight + 26
  ctx.fillText(truncateLabel(creatorName, 34), contentX, creatorY)

  const ccuText = formatCompactNumber(liveCcu)
  const metaRowY = height - 92
  const numberY = creatorY + (metaRowY - creatorY) * 0.5 + 18

  ctx.font = `800 172px ${TOKENS.typography.fontFamily}`
  ctx.textAlign = 'left'
  ctx.fillStyle =
    ccuColor === TOKENS.colors.accent1
      ? 'rgba(255, 55, 199, 0.38)'
      : 'rgba(0, 82, 255, 0.34)'
  ctx.fillText(ccuText, contentX, numberY + 10)

  ctx.fillStyle = ccuColor
  ctx.fillText(ccuText, contentX, numberY)

  drawMetaRow(ctx, contentX, metaRowY, formatApprovalPercent(approval), rankLabel)

  return canvasToBlob(canvas)
}
