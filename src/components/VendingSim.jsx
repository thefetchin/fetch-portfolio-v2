import { useEffect, useRef, useState } from 'react'
import './VendingSim.css'

const CATALOG = [
  { code: 'A1', name: 'Sandwich',     price: 80, src: '/sandwich.svg',       stock: 4 },
  { code: 'A2', name: 'Croissant',    price: 60, src: '/Croissant.svg',      stock: 3 },
  { code: 'A3', name: 'Donut',        price: 50, src: '/donut.svg',          stock: 5 },
  { code: 'B1', name: 'Spring Water', price: 30, src: '/green bottle.svg',   stock: 8 },
  { code: 'B2', name: 'Fizz Cola',    price: 40, src: '/drink can.svg',      stock: 6 },
  { code: 'B3', name: 'Trail Mix',    price: 70, src: '/dry fruit bag.svg',  stock: 4 },
  { code: 'C1', name: 'Choco Crunch', price: 45, src: '/chocolate-1.svg',    stock: 5 },
  { code: 'C2', name: 'Hazel Bar',    price: 55, src: '/chocolate-2.svg',    stock: 5 },
  { code: 'C3', name: 'Mint Bar',     price: 50, src: '/chocolate-3.svg',    stock: 0 },
]

const VendingSim = () => {
  const sectionRef = useRef(null)
  const windowRef = useRef(null)
  const slotRefs = useRef({})
  const doorRef = useRef(null)
  const dropIdRef = useRef(0)

  const [items, setItems] = useState(CATALOG)
  const [receipt, setReceipt] = useState([])  // recently dispensed items
  const [drops, setDrops] = useState([])      // currently falling SVGs
  const [doorFlash, setDoorFlash] = useState(false)
  const [message, setMessage] = useState('TAP A PRODUCT · UPI READY')
  const [konami, setKonami] = useState(0)

  // reveal-on-scroll
  useEffect(() => {
    const node = sectionRef.current
    if (!node) return
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('visible')),
      { threshold: 0.15 }
    )
    obs.observe(node)
    return () => obs.unobserve(node)
  }, [])

  const dispense = (code) => {
    const idx = items.findIndex((i) => i.code === code)
    if (idx === -1) return
    const item = items[idx]
    if (item.stock <= 0) {
      setMessage(`SOLD OUT · ${item.name.toUpperCase()}`)
      return
    }

    const slotEl = slotRefs.current[code]
    const winEl = windowRef.current
    const doorEl = doorRef.current
    if (!slotEl || !winEl || !doorEl) return

    const slotRect = slotEl.getBoundingClientRect()
    const winRect = winEl.getBoundingClientRect()
    const doorRect = doorEl.getBoundingClientRect()

    const startX = slotRect.left - winRect.left + slotRect.width / 2
    const startY = slotRect.top - winRect.top + slotRect.height / 2 + 4
    const endX = doorRect.left - winRect.left + doorRect.width / 2
    const endY = doorRect.top - winRect.top + doorRect.height / 2

    const id = ++dropIdRef.current
    setDrops((d) => [...d, { id, src: item.src, startX, startY, endX, endY }])

    // commit stock + UI updates immediately so subsequent clicks are responsive
    const newItems = [...items]
    newItems[idx] = { ...item, stock: item.stock - 1 }
    setItems(newItems)
    setMessage(`UPI ✓  ₹${item.price} · ${item.name.toUpperCase()}`)

    // flash door on landing and add to receipt
    setTimeout(() => setDoorFlash(true), 850)
    setTimeout(() => {
      setDoorFlash(false)
      setReceipt((r) => [
        { id, name: item.name, price: item.price, src: item.src },
        ...r,
      ].slice(0, 5))
      setDrops((d) => d.filter((x) => x.id !== id))
    }, 1050)
  }

  const restock = () => {
    setItems(CATALOG)
    setReceipt([])
    setMessage('RESTOCKED · TAP A PRODUCT')
  }

  const onBrandClick = () => {
    const next = konami + 1
    setKonami(next)
    if (next >= 5) {
      setKonami(0)
      const choco = items.find((i) => i.code === 'C1' && i.stock > 0)
      if (choco) {
        dispense('C1')
        setMessage('🎉 ON THE HOUSE · ENJOY')
      }
    }
  }

  return (
    <section id="simulator" ref={sectionRef} className="vsim">
      <div className="vsim-container">
        <div className="vsim-header">
          <span className="eyebrow">Try it yourself</span>
          <h2 className="section-title">
            Tap any snack. <span className="accent-text">Pay with UPI.</span>
          </h2>
          <p className="section-description">
            Every Fetch machine ships with a touch UI and on-screen UPI checkout —
            no codes, no fumbling for change. Give it a go.
          </p>
        </div>

        <div className="vsim-machine" role="application" aria-label="Vending machine simulator">
          {/* GLASS WINDOW */}
          <div className="vsim-window" ref={windowRef}>
            <div className="vsim-brand" onClick={onBrandClick} title="Fetch™">
              <span>FETCH</span>
              <span className="vsim-brand-dot" />
              <span className="vsim-brand-small">SmartVend 01 · UPI</span>
            </div>

            <div className="vsim-shelves">
              {items.map((it) => (
                <button
                  key={it.code}
                  type="button"
                  ref={(el) => (slotRefs.current[it.code] = el)}
                  className={`vsim-slot ${it.stock === 0 ? 'is-empty' : ''}`}
                  onClick={() => dispense(it.code)}
                  disabled={it.stock === 0}
                  aria-label={`${it.name}, ₹${it.price}, ${it.stock} in stock`}
                >
                  <div className="vsim-slot-img-wrap">
                    {it.stock > 0 ? (
                      <img src={it.src} alt="" className="vsim-slot-img" draggable="false" />
                    ) : (
                      <span className="vsim-slot-empty">SOLD OUT</span>
                    )}
                  </div>
                  <div className="vsim-slot-meta">
                    <span className="vsim-slot-name">{it.name}</span>
                    <span className="vsim-slot-price">₹{it.price}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* falling products */}
            {drops.map((d) => (
              <img
                key={d.id}
                src={d.src}
                alt=""
                className="vsim-falling"
                style={{
                  '--start-x': `${d.startX}px`,
                  '--start-y': `${d.startY}px`,
                  '--end-x': `${d.endX}px`,
                  '--end-y': `${d.endY}px`,
                }}
                aria-hidden="true"
              />
            ))}

            {/* DELIVERY DOOR */}
            <div
              ref={doorRef}
              className={`vsim-door ${doorFlash ? 'is-flashing' : ''}`}
              aria-hidden="true"
            >
              <div className="vsim-door-frame">
                <img src="/fetch-logo.svg" alt="" className="vsim-door-logo" />
                <span className="vsim-door-label">PUSH · COLLECT</span>
              </div>
              <div className="vsim-door-slit" />
            </div>
          </div>

          {/* CONTROL / SCREEN PANEL */}
          <div className="vsim-panel">
            <div className="vsim-screen" role="status" aria-live="polite">
              <div className="vsim-screen-top">
                <span className="vsim-upi-chip">
                  <span className="vsim-upi-dot" />
                  UPI ONLINE
                </span>
                <span className="vsim-screen-time">FETCH OS</span>
              </div>
              <div className="vsim-screen-msg">{message}</div>
            </div>

            <div className="vsim-receipt">
              <div className="vsim-receipt-head">
                <span>Your order</span>
                <span>{receipt.length} items</span>
              </div>
              {receipt.length === 0 && (
                <div className="vsim-receipt-empty">Items you collect will appear here.</div>
              )}
              <ul className="vsim-receipt-list">
                {receipt.map((r) => (
                  <li key={r.id} className="vsim-receipt-item">
                    <img src={r.src} alt="" className="vsim-receipt-img" />
                    <span className="vsim-receipt-name">{r.name}</span>
                    <span className="vsim-receipt-price">₹{r.price}</span>
                  </li>
                ))}
              </ul>
              {receipt.length > 0 && (
                <div className="vsim-receipt-total">
                  <span>Total paid via UPI</span>
                  <strong>₹{receipt.reduce((s, r) => s + r.price, 0)}</strong>
                </div>
              )}
            </div>

            <button type="button" className="vsim-restock" onClick={restock}>
              Restock machine
            </button>
          </div>
        </div>

        <p className="vsim-footnote">
          Tip: tap any product to dispense it. Psst — try clicking the FETCH logo a few times.
        </p>
      </div>
    </section>
  )
}

export default VendingSim
