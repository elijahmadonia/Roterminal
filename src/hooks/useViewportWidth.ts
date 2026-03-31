import { useEffect, useState } from 'react'

function getViewportWidth() {
  if (typeof window === 'undefined') {
    return 0
  }

  return window.innerWidth
}

export function useViewportWidth() {
  const [width, setWidth] = useState(getViewportWidth)

  useEffect(() => {
    const updateWidth = () => {
      setWidth(getViewportWidth())
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)

    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  return width
}
