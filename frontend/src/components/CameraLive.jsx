import { useEffect, useRef } from 'react'

// MJPEG-трансляция камеры. Chrome не закрывает поток, когда <img> исчезает или меняет src,
// и бэкенд продолжает гонять ffmpeg. Поэтому src задаём сами и при закрытии явно сбрасываем.
export default function CameraLive({ roomId, alt, className, onError }) {
  const imgRef = useRef(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img || !roomId) return undefined
    img.src = `/api/rooms/${roomId}/camera/live?ts=${Date.now()}`
    return () => {
      img.removeAttribute('src')
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
    }
  }, [roomId])

  return <img ref={imgRef} alt={alt} className={className} onError={onError} />
}
