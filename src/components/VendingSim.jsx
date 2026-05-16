import { useEffect, useMemo, useRef, useState } from 'react'
import { useEggs } from '../context/EggContext'
import './VendingSim.css'

// Off-menu items revealed by the long-press "secret menu" easter egg.
// They reuse existing SVG assets, but live outside the regular shelves and
// don't consume catalog stock.
const SECRET_MENU = [
  { id: 'S1', name: 'Cold Brew Float',   price: 65, src: '/green bottle.svg' },
  { id: 'S2', name: 'Founder’s Cookie',  price: 35, src: '/Croissant.svg' },
  { id: 'S3', name: 'Mystery Bag',       price: 40, src: '/dry fruit bag.svg' },
]

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

// Decorative QR pattern (21x21) with the standard three finder squares
const QR_SIZE = 21
const QR_GRID = (() => {
  const g = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(0))
  const placeFinder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6
        const innerSquare = r >= 2 && r <= 4 && c >= 2 && c <= 4
        g[r0 + r][c0 + c] = onBorder || innerSquare ? 1 : 0
      }
    }
  }
  placeFinder(0, 0)
  placeFinder(0, QR_SIZE - 7)
  placeFinder(QR_SIZE - 7, 0)
  let seed = 1337
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let r = 0; r < QR_SIZE; r++) {
    for (let c = 0; c < QR_SIZE; c++) {
      const inFinder =
        (r < 8 && c < 8) ||
        (r < 8 && c >= QR_SIZE - 8) ||
        (r >= QR_SIZE - 8 && c < 8)
      if (inFinder) continue
      if (rand() > 0.52) g[r][c] = 1
    }
  }
  return g
})()

const VendingSim = () => {
  const sectionRef = useRef(null)
  const windowRef = useRef(null)
  const slotRefs = useRef({})
  const doorRef = useRef(null)
  const dropIdRef = useRef(0)
  const cartIdRef = useRef(0)

  const { konamiActive, setKonamiActive, triggerConfetti, showToast } = useEggs()

  const [items, setItems] = useState(CATALOG)
  const [cart, setCart] = useState([])           // queued purchases
  const [mode, setMode] = useState('idle')       // 'idle' | 'paying' | 'paid' | 'awaiting' | 'opening'
  const [drops, setDrops] = useState([])         // currently falling SVGs into door
  const [insideDoor, setInsideDoor] = useState([]) // items that have landed inside the door
  const [doorFlash, setDoorFlash] = useState(false)
  const [receipt, setReceipt] = useState([])
  const [message, setMessage] = useState('TAP SNACKS · THEN PAY VIA UPI')
  const [konami, setKonami] = useState(0)
  const [snackHero, setSnackHero] = useState(null)   // { count } chip persisted until restock
  const [secretOpen, setSecretOpen] = useState(false)

  const longPressTimerRef = useRef(null)
  const longPressFiredRef = useRef(false)

  // pricing helper — konami mode makes everything free
  const priceOf = (p) => (konamiActive ? 0 : p)

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

  // Reservable stock: we only mark items as "used" when collected, but the
  // shelf shows the live remaining count (current stock minus what's already
  // reserved in cart or sitting in the door).
  const reservedCounts = useMemo(() => {
    const m = {}
    for (const c of cart) m[c.code] = (m[c.code] || 0) + 1
    for (const c of insideDoor) m[c.code] = (m[c.code] || 0) + 1
    return m
  }, [cart, insideDoor])

  const remainingFor = (code) => {
    const item = items.find((i) => i.code === code)
    if (!item) return 0
    return item.stock - (reservedCounts[code] || 0)
  }

  const cartTotal = useMemo(
    () => cart.reduce((s, c) => s + priceOf(c.price), 0),
    [cart, konamiActive]
  )

  const addToCart = (code) => {
    if (mode !== 'idle') return
    const item = items.find((i) => i.code === code)
    if (!item) return
    if (remainingFor(code) <= 0) {
      setMessage(`SOLD OUT · ${item.name.toUpperCase()}`)
      return
    }
    const id = ++cartIdRef.current
    setCart((c) => [...c, { id, code, name: item.name, price: item.price, src: item.src }])
    setMessage(`ADDED · ${item.name.toUpperCase()}`)
  }

  const removeFromCart = (id) => {
    if (mode !== 'idle') return
    setCart((c) => c.filter((x) => x.id !== id))
  }

  const startPayment = () => {
    if (cart.length === 0 || mode !== 'idle') return
    setMode('paying')
    setMessage(konamiActive ? `KONAMI MODE · ₹0` : `SCAN TO PAY ₹${cartTotal}`)
    // Konami mode skips most of the scanning animation
    const successAt = konamiActive ? 700 : 2400
    const releaseAt = konamiActive ? 1200 : 3100
    setTimeout(() => {
      setMode('paid')
      setMessage('PAYMENT SUCCESSFUL ✓')
    }, successAt)
    setTimeout(() => {
      releaseCartToDoor()
    }, releaseAt)
  }

  const releaseCartToDoor = () => {
    const winEl = windowRef.current
    const doorEl = doorRef.current
    if (!winEl || !doorEl) {
      setMode('idle')
      return
    }
    const winRect = winEl.getBoundingClientRect()
    const doorRect = doorEl.getBoundingClientRect()
    const endX = doorRect.left - winRect.left + doorRect.width / 2
    const endY = doorRect.top - winRect.top + doorRect.height / 2

    setMode('awaiting')
    setMessage('PUSH THE DOOR TO COLLECT')

    cart.forEach((c, i) => {
      const slotEl = slotRefs.current[c.code]
      let startX
      let startY
      if (slotEl) {
        const slotRect = slotEl.getBoundingClientRect()
        startX = slotRect.left - winRect.left + slotRect.width / 2
        startY = slotRect.top - winRect.top + slotRect.height / 2
      } else {
        // Secret-menu items don't live on a shelf — fall from the top centre.
        startX = winRect.width / 2
        startY = 40
      }

      const id = ++dropIdRef.current
      // stagger drops
      setTimeout(() => {
        setDrops((d) => [...d, { id, src: c.src, startX, startY, endX, endY }])
        // flash door briefly on landing
        setTimeout(() => setDoorFlash(true), 800)
        setTimeout(() => setDoorFlash(false), 1000)
        // after fall completes, move into "inside door" state
        setTimeout(() => {
          setInsideDoor((arr) => [
            ...arr,
            { id, code: c.code, name: c.name, price: c.price, src: c.src },
          ])
          setDrops((d) => d.filter((x) => x.id !== id))
        }, 950)
      }, i * 220)
    })

    // clear cart immediately (those items are committed)
    setCart([])
  }

  const openDoor = () => {
    if (mode !== 'awaiting' || insideDoor.length === 0) return
    setMode('opening')

    const count = insideDoor.length
    if (count >= 4) {
      setMessage(`SNACK HERO · ${count} ITEMS ✨`)
      setSnackHero({ count })
      // confetti burst out of the door
      const doorEl = doorRef.current
      if (doorEl) {
        const r = doorEl.getBoundingClientRect()
        triggerConfetti({
          origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          count: 60,
          duration: 1700,
          spreadY: -120,
        })
      }
    } else {
      setMessage('COLLECT YOUR ORDER')
    }

    // commit stock decrement now (these have been paid + dispensed).
    // Secret-menu items aren't part of the shelf catalog, so they're ignored.
    setItems((curr) =>
      curr.map((it) => {
        const used = insideDoor.filter((d) => d.code === it.code).length
        return used ? { ...it, stock: Math.max(0, it.stock - used) } : it
      })
    )
    // after the open + enlarge animation, slide items into receipt
    setTimeout(() => {
      setReceipt((r) => [...insideDoor.map((d) => ({ ...d })), ...r].slice(0, 8))
      setInsideDoor([])
      setMode('idle')
      setMessage('ENJOY · TAP SNACKS FOR ANOTHER ORDER')
    }, 2200)
  }

  const restock = () => {
    setItems(CATALOG)
    setReceipt([])
    setCart([])
    setInsideDoor([])
    setDrops([])
    setMode('idle')
    setSnackHero(null)
    if (konamiActive) setKonamiActive(false)
    setMessage('RESTOCKED · TAP SNACKS · THEN PAY VIA UPI')
  }

  const onBrandClick = () => {
    if (longPressFiredRef.current) {
      // a long-press just fired — swallow the trailing click
      longPressFiredRef.current = false
      return
    }
    if (mode !== 'idle') return
    const next = konami + 1
    setKonami(next)
    if (next >= 5) {
      setKonami(0)
      const choco = items.find((i) => i.code === 'C1' && remainingFor('C1') > 0)
      if (choco) {
        addToCart('C1')
        setMessage('🎉 ADDED ON THE HOUSE · C1')
      }
    }
  }

  // Long-press the FETCH logo to reveal the off-menu Secret Menu
  const startLongPress = () => {
    if (mode !== 'idle') return
    longPressFiredRef.current = false
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      setSecretOpen(true)
      showToast('Secret Menu unlocked 🤫')
    }, 1100)
  }

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const addSecret = (s) => {
    if (mode !== 'idle') return
    const id = ++cartIdRef.current
    setCart((c) => [...c, { id, code: s.id, name: s.name, price: s.price, src: s.src }])
    setMessage(`ADDED · ${s.name.toUpperCase()}`)
    setSecretOpen(false)
  }

  const upiAmount = cartTotal

  return (
    <section id="simulator" ref={sectionRef} className="vsim">
      <div className="vsim-container">
        <div className="vsim-header">
          <span className="eyebrow">Try it yourself</span>
          <h2 className="section-title">
            Tap. Pay with UPI. <span className="accent-text">Collect.</span>
          </h2>
          <p className="section-description">
            A miniature of the real Fetch experience — pick what you want, scan to pay,
            then push the door to collect your snacks.
          </p>
        </div>

        <div className="vsim-machine" role="application" aria-label="Vending machine simulator">
          {/* GLASS WINDOW */}
          <div className="vsim-window" ref={windowRef}>
            <div
              className="vsim-brand"
              onClick={onBrandClick}
              onMouseDown={startLongPress}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={startLongPress}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
              title="Fetch™"
            >
              <span>FETCH</span>
              <span className="vsim-brand-dot" />
              <span className="vsim-brand-small">SmartVend 01 · UPI</span>
              {konamiActive && <span className="vsim-brand-mode">KONAMI</span>}
            </div>

            <div className="vsim-shelves">
              {items.map((it) => {
                const remaining = remainingFor(it.code)
                const isOut = remaining <= 0
                return (
                  <button
                    key={it.code}
                    type="button"
                    ref={(el) => (slotRefs.current[it.code] = el)}
                    className={`vsim-slot ${isOut ? 'is-empty' : ''}`}
                    onClick={() => addToCart(it.code)}
                    disabled={isOut || mode !== 'idle'}
                    aria-label={`${it.name}, ₹${it.price}, ${remaining} remaining`}
                  >
                    <div className="vsim-slot-img-wrap">
                      {!isOut ? (
                        <img src={it.src} alt="" className="vsim-slot-img" draggable="false" />
                      ) : (
                        <span className="vsim-slot-empty">SOLD OUT</span>
                      )}
                    </div>
                    <div className="vsim-slot-meta">
                      <span className="vsim-slot-name">{it.name}</span>
                      <span className="vsim-slot-price">
                        {konamiActive ? (
                          <>
                            <s>₹{it.price}</s> ₹0
                          </>
                        ) : (
                          `₹${it.price}`
                        )}
                      </span>
                    </div>
                  </button>
                )
              })}
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
              className={[
                'vsim-door',
                doorFlash ? 'is-flashing' : '',
                mode === 'awaiting' && insideDoor.length > 0 ? 'is-ready' : '',
                mode === 'opening' ? 'is-open' : '',
              ].join(' ')}
            >
              <button
                type="button"
                className="vsim-door-frame"
                onClick={openDoor}
                disabled={!(mode === 'awaiting' && insideDoor.length > 0)}
                aria-label="Push the door to collect"
              >
                <img src="/fetch-logo.svg" alt="" className="vsim-door-logo" />
                <span className="vsim-door-label">
                  {mode === 'awaiting' && insideDoor.length > 0
                    ? 'PUSH TO COLLECT'
                    : mode === 'opening'
                    ? 'COLLECTING…'
                    : 'PUSH · COLLECT'}
                </span>
              </button>

              {/* Items revealed when door opens */}
              <div className="vsim-door-reveal">
                {insideDoor.map((d, i) => (
                  <img
                    key={d.id}
                    src={d.src}
                    alt={d.name}
                    className="vsim-door-item"
                    style={{ animationDelay: `${i * 90}ms` }}
                  />
                ))}
              </div>

              <div className="vsim-door-slit" />
            </div>

            {/* SECRET MENU POPOVER */}
            {secretOpen && (
              <div className="vsim-secret" role="dialog" aria-label="Secret menu">
                <div className="vsim-secret-card">
                  <div className="vsim-secret-head">
                    <span>Secret Menu <span aria-hidden="true">🤫</span></span>
                    <button
                      type="button"
                      className="vsim-secret-x"
                      onClick={() => setSecretOpen(false)}
                      aria-label="Close secret menu"
                    >
                      ×
                    </button>
                  </div>
                  <ul className="vsim-secret-list">
                    {SECRET_MENU.map((s) => (
                      <li key={s.id} className="vsim-secret-item">
                        <img src={s.src} alt="" className="vsim-secret-img" />
                        <span className="vsim-secret-name">{s.name}</span>
                        <span className="vsim-secret-price">
                          {konamiActive ? <s>₹{s.price}</s> : `₹${s.price}`}
                          {konamiActive && ' ₹0'}
                        </span>
                        <button
                          type="button"
                          className="vsim-secret-add"
                          onClick={() => addSecret(s)}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* PAYMENT OVERLAY */}
            {(mode === 'paying' || mode === 'paid') && (
              <div className="vsim-pay">
                <div className="vsim-pay-card">
                  <div className="vsim-pay-head">
                    <span className="vsim-pay-title">Pay with UPI</span>
                    <span className="vsim-pay-amount">₹{upiAmount}</span>
                  </div>

                  <div className={`vsim-qr ${mode === 'paid' ? 'is-paid' : ''}`}>
                    <div className="vsim-qr-grid" aria-hidden="true">
                      {QR_GRID.flatMap((row, r) =>
                        row.map((cell, c) => (
                          <span
                            key={`${r}-${c}`}
                            className={cell ? 'vsim-qr-cell on' : 'vsim-qr-cell'}
                          />
                        ))
                      )}
                    </div>
                    {mode === 'paying' && <div className="vsim-qr-scan" aria-hidden="true" />}
                    {mode === 'paid' && (
                      <div className="vsim-qr-check" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="64" height="64" fill="none">
                          <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" />
                          <path
                            d="M7 12.5l3.2 3.2L17 9"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="vsim-pay-foot">
                    {mode === 'paying'
                      ? 'Scanning…  Open any UPI app to pay'
                      : 'Payment successful · dispensing'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CONTROL PANEL */}
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

            {snackHero && (
              <div className="vsim-chip">
                <span aria-hidden="true">🏆</span>
                Snack Hero · {snackHero.count} items in one order
              </div>
            )}

            <div className="vsim-cart">
              <div className="vsim-cart-head">
                <span>Your order</span>
                <span>{cart.length} items</span>
              </div>
              {cart.length === 0 && (
                <div className="vsim-cart-empty">Tap any snack to add it.</div>
              )}
              <ul className="vsim-cart-list">
                {cart.map((c) => (
                  <li key={c.id} className="vsim-cart-item">
                    <img src={c.src} alt="" className="vsim-cart-img" />
                    <span className="vsim-cart-name">{c.name}</span>
                    <span className="vsim-cart-price">₹{priceOf(c.price)}</span>
                    <button
                      type="button"
                      className="vsim-cart-x"
                      onClick={() => removeFromCart(c.id)}
                      aria-label={`Remove ${c.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="vsim-pay-btn"
                onClick={startPayment}
                disabled={cart.length === 0 || mode !== 'idle'}
              >
                {cart.length === 0 ? 'Add items to pay' : `Pay ₹${cartTotal} with UPI`}
              </button>
            </div>

            {receipt.length > 0 && (
              <div className="vsim-history">
                <div className="vsim-history-head">Collected</div>
                <ul className="vsim-history-list">
                  {receipt.map((r) => (
                    <li key={r.id} className="vsim-history-item">
                      <img src={r.src} alt="" className="vsim-history-img" />
                      <span className="vsim-history-name">{r.name}</span>
                      <span className="vsim-history-price">₹{r.price}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button type="button" className="vsim-restock" onClick={restock}>
              Restock machine
            </button>
          </div>
        </div>

        <p className="vsim-footnote">
          Tap snacks · scan the QR · push the door. (Psst — short-tap the FETCH logo a few times,
          or hold it for a moment. Konami fans, the cabinet has a surprise for you too.)
        </p>
      </div>
    </section>
  )
}

export default VendingSim
