import { useEffect, useMemo, useRef, useState } from 'react'
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

const DENOMS = [10, 20, 50, 100]

const VendingSim = () => {
  const sectionRef = useRef(null)
  const [credit, setCredit] = useState(0)
  const [entry, setEntry] = useState('')
  const [items, setItems] = useState(CATALOG)
  const [dropped, setDropped] = useState(null)        // currently dropping item
  const [tray, setTray] = useState([])                // dispensed items in tray
  const [message, setMessage] = useState('INSERT COINS')
  const [konami, setKonami] = useState(0)             // easter egg counter

  // reveal-on-scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible')
        })
      },
      { threshold: 0.15 }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => sectionRef.current && observer.unobserve(sectionRef.current)
  }, [])

  const setMsg = (m) => {
    setMessage(m)
  }

  const insertCoin = (n) => {
    setCredit((c) => c + n)
    setMsg(`+ ₹${n} · BALANCE ₹${credit + n}`)
  }

  const pressKey = (k) => {
    if (k === 'CLR') {
      setEntry('')
      setMsg('READY')
      return
    }
    if (k === 'OK') {
      handleVend(entry)
      return
    }
    setEntry((prev) => {
      const next = (prev + k).slice(-2)
      // when 2 chars, attempt vend automatically after small UX cue
      if (next.length === 2) {
        setTimeout(() => handleVend(next), 120)
      } else {
        setMsg(`SELECT · ${next}_`)
      }
      return next
    })
  }

  const refund = () => {
    if (credit === 0) {
      setMsg('NO BALANCE')
      return
    }
    setMsg(`REFUND ₹${credit}`)
    setCredit(0)
    setEntry('')
  }

  const handleVend = (code) => {
    const idx = items.findIndex((it) => it.code === code)
    if (idx === -1) {
      setMsg(`ERR · "${code}" UNKNOWN`)
      setEntry('')
      return
    }
    const item = items[idx]
    if (item.stock <= 0) {
      setMsg(`SOLD OUT · ${item.code}`)
      setEntry('')
      return
    }
    if (credit < item.price) {
      setMsg(`NEED ₹${item.price - credit} MORE`)
      setEntry('')
      return
    }

    // dispense
    const newItems = [...items]
    newItems[idx] = { ...item, stock: item.stock - 1 }
    setItems(newItems)
    setCredit((c) => c - item.price)
    setEntry('')
    setDropped({ ...item, id: Date.now() })
    setMsg(`DISPENSING · ${item.name.toUpperCase()}`)

    setTimeout(() => {
      setTray((t) => [...t.slice(-3), { ...item, id: Date.now() + 1 }])
      setDropped(null)
      setMsg('ENJOY · THANK YOU')
    }, 900)
  }

  const reset = () => {
    setItems(CATALOG)
    setTray([])
    setCredit(0)
    setEntry('')
    setMsg('RESTOCKED')
  }

  // easter egg: 5 clicks on the brand panel triggers a free chocolate
  const onBrandClick = () => {
    const next = konami + 1
    setKonami(next)
    if (next >= 5) {
      setKonami(0)
      const choco = items.find((i) => i.code === 'C1' && i.stock > 0)
      if (choco) {
        setTray((t) => [...t.slice(-3), { ...choco, id: Date.now() }])
        const idx = items.findIndex((i) => i.code === 'C1')
        const newItems = [...items]
        newItems[idx] = { ...choco, stock: choco.stock - 1 }
        setItems(newItems)
        setMsg('🎉 ON THE HOUSE')
      }
    }
  }

  const keypadKeys = ['A', 'B', 'C', '1', '2', '3', 'CLR', '0', 'OK']

  const totalStock = useMemo(() => items.reduce((s, it) => s + it.stock, 0), [items])

  return (
    <section id="simulator" ref={sectionRef} className="vsim">
      <div className="vsim-container">
        <div className="vsim-header">
          <span className="eyebrow">Try it yourself</span>
          <h2 className="section-title">
            Take a Fetch machine for a <span className="accent-text">spin.</span>
          </h2>
          <p className="section-description">
            Insert virtual coins, punch in a code, and watch your snack drop.
            A tiny taste of how every Fetch machine works in the wild.
          </p>
        </div>

        <div className="vsim-machine" role="application" aria-label="Vending machine simulator">
          {/* LEFT — GLASS WINDOW WITH PRODUCTS */}
          <div className="vsim-window">
            <div className="vsim-brand" onClick={onBrandClick} title="Fetch™">
              <span>FETCH</span>
              <span className="vsim-brand-dot" />
              <span className="vsim-brand-small">SmartVend 01</span>
            </div>

            <div className="vsim-shelves">
              {items.map((it) => (
                <button
                  key={it.code}
                  type="button"
                  className={`vsim-slot ${it.stock === 0 ? 'is-empty' : ''}`}
                  onClick={() => handleVend(it.code)}
                  disabled={it.stock === 0}
                  aria-label={`${it.code} ${it.name}, ₹${it.price}, ${it.stock} in stock`}
                >
                  <div className="vsim-slot-img-wrap">
                    {it.stock > 0 ? (
                      <img src={it.src} alt="" className="vsim-slot-img" draggable="false" />
                    ) : (
                      <span className="vsim-slot-empty">SOLD OUT</span>
                    )}
                  </div>
                  <div className="vsim-slot-meta">
                    <span className="vsim-slot-code">{it.code}</span>
                    <span className="vsim-slot-price">₹{it.price}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="vsim-tray" aria-live="polite">
              {dropped && (
                <img
                  key={dropped.id}
                  src={dropped.src}
                  alt=""
                  className="vsim-drop"
                />
              )}
              <div className="vsim-tray-floor">
                {tray.map((t) => (
                  <img key={t.id} src={t.src} alt={t.name} className="vsim-tray-item" />
                ))}
                {tray.length === 0 && <span className="vsim-tray-hint">Dispensed items appear here</span>}
              </div>
            </div>
          </div>

          {/* RIGHT — CONTROL PANEL */}
          <div className="vsim-panel">
            <div className="vsim-screen" role="status" aria-live="polite">
              <div className="vsim-screen-row">
                <span className="vsim-screen-label">BAL</span>
                <span className="vsim-screen-value">₹{credit}</span>
              </div>
              <div className="vsim-screen-msg">{message}</div>
            </div>

            <div className="vsim-keypad">
              {keypadKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`vsim-key ${k === 'OK' ? 'is-ok' : ''} ${k === 'CLR' ? 'is-clr' : ''}`}
                  onClick={() => pressKey(k)}
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="vsim-coins">
              <div className="vsim-coins-label">Insert</div>
              <div className="vsim-coins-grid">
                {DENOMS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="vsim-coin"
                    onClick={() => insertCoin(d)}
                  >
                    ₹{d}
                  </button>
                ))}
              </div>
            </div>

            <div className="vsim-actions">
              <button type="button" className="vsim-btn vsim-btn-secondary" onClick={refund}>
                Refund
              </button>
              <button type="button" className="vsim-btn vsim-btn-ghost" onClick={reset}>
                Restock
              </button>
            </div>

            <div className="vsim-meta">
              <span>Stock <strong>{totalStock}</strong></span>
              <span>UPI · Cards · Cash</span>
            </div>
          </div>
        </div>

        <p className="vsim-footnote">
          Tip: punch <kbd>A</kbd><kbd>1</kbd> after adding credit. (Psst — try clicking the FETCH logo a few times.)
        </p>
      </div>
    </section>
  )
}

export default VendingSim
