import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Scan or type a code to pick a product.
 *
 * Two input paths, because a warehouse and a phone are different places:
 *
 *  - A USB/Bluetooth barcode scanner is a keyboard. It types the digits and
 *    presses Enter, so a plain focused text input already works with no setup,
 *    no permissions and no library. This is the path that matters in a
 *    warehouse, and it is why the field is a real input rather than a button
 *    that opens a camera.
 *
 *  - The camera, via the browser's own BarcodeDetector. No dependency, but it
 *    is not in every browser, so the button only appears when it is actually
 *    available -- offering a camera that then fails is worse than not offering
 *    one.
 *
 * Resolution is server-side through /api/inv/batches/lookup, which already
 * understands both our batch codes and manufacturer barcodes. Doing it there
 * rather than filtering a local list means a scan works even for a product this
 * page has not loaded.
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']

/** Feature-detected once: the API exists in some browsers and not others. */
const detectorSupported = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window

export default function BarcodeInput({
  onProduct,
  onBatch,
  label = 'Scan or type a barcode',
  hint = null,
  autoFocus = false,
}) {
  const [code, setCode] = useState('')
  const [state, setState] = useState('idle')   // idle | looking | found | miss
  const [message, setMessage] = useState(null)
  const [camera, setCamera] = useState(false)
  const [canScan, setCanScan] = useState(false)

  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const loopRef = useRef(null)

  useEffect(() => { setCanScan(detectorSupported()) }, [])

  const stopCamera = useCallback(() => {
    if (loopRef.current) { cancelAnimationFrame(loopRef.current); loopRef.current = null }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }
    setCamera(false)
  }, [])

  // Releasing the camera on unmount is not optional: a live track keeps the
  // device light on and looks like the page is still watching.
  useEffect(() => stopCamera, [stopCamera])

  const resolve = useCallback(async (raw) => {
    const value = String(raw || '').trim()
    if (!value) return
    setState('looking'); setMessage(null)

    try {
      const res = await fetch(`/api/inv/batches/lookup?code=${encodeURIComponent(value)}`)
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.match === 'batch') {
        setState('found')
        setMessage(`${data.batch.productName} · batch ${data.batch.code}${
          data.batch.expired ? ' · EXPIRED' : ''}`)
        onBatch?.(data.batch)
        onProduct?.({ id: data.batch.productId, name: data.batch.productName })
        setCode('')
        return
      }
      if (res.ok && data.match === 'product') {
        setState('found')
        setMessage(`${data.product.name}`)
        onProduct?.(data.product, data.batches || [])
        setCode('')
        return
      }

      setState('miss')
      setMessage(
        data.message
        || 'Nothing matched that code. Add the product first, or import it from VLite.'
      )
    } catch {
      setState('miss')
      setMessage('Could not reach the server.')
    }
  }, [onBatch, onProduct])

  const startCamera = async () => {
    setMessage(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setCamera(true)

      // The video element only exists once `camera` is true, so wait a frame.
      await new Promise((r) => requestAnimationFrame(r))
      const video = videoRef.current
      if (!video) { stopCamera(); return }
      video.srcObject = stream
      await video.play()

      // eslint-disable-next-line no-undef
      const detector = new BarcodeDetector({ formats: FORMATS })
      const tick = async () => {
        if (!streamRef.current) return
        try {
          const found = await detector.detect(video)
          if (found.length) {
            const value = found[0].rawValue
            stopCamera()
            await resolve(value)
            return
          }
        } catch { /* a frame that cannot be decoded is normal; keep looking */ }
        loopRef.current = requestAnimationFrame(tick)
      }
      loopRef.current = requestAnimationFrame(tick)
    } catch (err) {
      stopCamera()
      setState('miss')
      setMessage(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was refused. Type the code instead.'
          : 'Could not open the camera. Type the code instead.'
      )
    }
  }

  return (
    <div className="bc">
      <label className="bc-field">
        <span>{label}</span>
        <div className="bc-row">
          <input
            ref={inputRef}
            value={code}
            autoFocus={autoFocus}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="8901491101837 or B00015"
            onChange={(e) => { setCode(e.target.value); setState('idle'); setMessage(null) }}
            onKeyDown={(e) => {
              // A hardware scanner ends its burst with Enter. Submitting the
              // surrounding form here would be wrong, so swallow it.
              if (e.key === 'Enter') { e.preventDefault(); resolve(code) }
            }}
            className={state === 'miss' ? 'is-bad' : state === 'found' ? 'is-good' : ''}
            aria-describedby="bc-msg"
          />
          <button type="button" className="bc-go" onClick={() => resolve(code)} disabled={!code.trim() || state === 'looking'}>
            {state === 'looking' ? '…' : 'Find'}
          </button>
          {canScan && !camera && (
            <button type="button" className="bc-cam" onClick={startCamera} title="Scan with the camera">
              Camera
            </button>
          )}
          {camera && (
            <button type="button" className="bc-cam is-on" onClick={stopCamera}>
              Stop
            </button>
          )}
        </div>
      </label>

      {camera && (
        <div className="bc-cam-wrap">
          <video ref={videoRef} className="bc-video" muted playsInline />
          <div className="bc-reticle" aria-hidden="true" />
          <p className="bc-cam-hint">Hold the barcode inside the frame.</p>
        </div>
      )}

      <p id="bc-msg" className={`bc-msg bc-msg-${state}`} role="status">
        {message || hint || (canScan
          ? 'A USB scanner works straight into this box. Or use the camera.'
          : 'A USB scanner works straight into this box — it types the code and presses Enter.')}
      </p>
    </div>
  )
}
