import { useEffect, useRef } from 'react'

const SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
]

export default function useKonami(onFired) {
  const idxRef = useRef(0)
  const cbRef = useRef(onFired)
  cbRef.current = onFired

  useEffect(() => {
    const handler = (e) => {
      const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key
      const expected = SEQUENCE[idxRef.current]
      if (key === expected) {
        idxRef.current += 1
        if (idxRef.current === SEQUENCE.length) {
          idxRef.current = 0
          cbRef.current && cbRef.current()
        }
      } else {
        // allow restart if the wrong key matches the first key of the sequence
        idxRef.current = key === SEQUENCE[0] ? 1 : 0
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
