/* =====================================================================
   vNetra ← VLite product images
   =====================================================================
   GENERATED FILE — do not edit by hand.
   Produced by scripts/vnetra-bulk-export.py, which fills in the map below.

   Generated: __GENERATED_AT__
   Products in this run: __COUNT__

   Copies each product's image from VLite into vNetra, matching on Product
   Code, which is identical in both systems.

   HOW TO RUN
     1. Open https://vnetra.in/products/view and sign in.
     2. DevTools → Console (Cmd+Option+J), paste this whole file, Enter.
     3. It works through the list by itself. Leave the tab in the foreground.

   Progress:        __imgSync.progress()
   Stop cleanly:    __imgSync.stop = true
   Resume:          __imgSync.runAll()
   Retry failures:  __imgSync.retryFailed()

   It drives the list by typing each product code into the Name/Code search
   box, never by paging. Saving a product sends vNetra back to page 1, so a
   paging version loses every product after the first page — it looks for the
   row it just saved, cannot find it, and re-walks page 1 forever.

   Only the product image is written. No other field is touched, products that
   already have an image are skipped, and the edit form is checked to be
   showing the expected product BEFORE anything is attached.
   ===================================================================== */
(() => {
const MAP = __MAP__;
const BASE = '__IMAGE_BASE__';
const CODES = Object.keys(MAP);

const S = window.__imgSync = window.__imgSync || {
  done: [], failed: [], skipped: [], running: false, current: null,
  startedAt: null, stop: false,
};
S.map = MAP;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, timeout = 20000, step = 200) => {
  const end = Date.now() + timeout;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); }
};
const rows     = () => [...document.querySelectorAll('tr')];
const codeOf   = (r) => [...r.querySelectorAll('td')].map((c) => c.textContent.trim()).find((t) => /^AT1/.test(t));
const rowFor   = (code) => rows().find((r) => codeOf(r) === code);
const hasThumb = (r) => (r?.querySelector('img')?.src || '').includes('products%2Fthumbs');
const seen     = (c) => S.done.includes(c) || S.failed.some((f) => f.code === c) || S.skipped.some((s) => s.code === c);
const onList   = () => location.href.includes('/products/view');

/* React owns the search input, so the value has to go in through the native
   setter or the component never sees it. */
async function searchFor(code) {
  if (!onList()) {
    [...document.querySelectorAll('button')].find((b) => /close/i.test(b.textContent))?.click();
    await until(onList, 10000);
  }
  const input = await until(() => document.querySelector('#product'), 10000);
  if (!input) return null;

  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(250);
  set.call(input, code);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  return await until(() => {
    const rs = rows().filter((r) => codeOf(r));
    return rs.length === 1 && codeOf(rs[0]) === code ? rs[0] : null;
  }, 15000);
}

S.processOne = async (code) => {
  S.current = code;
  const path = S.map[code];
  if (!path) { S.skipped.push({ code, why: 'no VLite image' }); return; }

  let row = await searchFor(code);
  if (!row) { S.failed.push({ code, why: 'not found in vNetra' }); console.warn('  FAIL', code, 'not found in vNetra'); return; }
  if (hasThumb(row)) { S.skipped.push({ code, why: 'already has an image' }); console.log('  skip', code); return; }

  const btn = [...row.querySelectorAll('button,[role=button]')]
    .find((b) => /edit/i.test(b.getAttribute('aria-label') || b.title || '')) || row.querySelectorAll('button')[0];
  if (!btn) { S.failed.push({ code, why: 'no edit control' }); console.warn('  FAIL', code, 'no edit control'); return; }
  btn.click();

  const right = await until(() => location.href.includes('/products/edit')
    && [...document.querySelectorAll('input')].some((i) => i.value === code), 20000);
  if (!right) {
    S.failed.push({ code, why: 'edit form did not open for this product' });
    console.warn('  FAIL', code, 'wrong form — closed without saving');
    [...document.querySelectorAll('button')].find((b) => /close/i.test(b.textContent))?.click();
    await until(onList, 10000);
    return;
  }

  try {
    const input = await until(() => document.querySelector('input#theFile[name=product_image]'), 8000);
    if (!input) throw new Error('no product image input');

    const blob = await fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error('image HTTP ' + r.status);
      return r.blob();
    });
    const isJpg = /\.jpe?g$/i.test(path);
    const dt = new DataTransfer();
    dt.items.add(new File([blob], code + (isJpg ? '.jpg' : '.png'),
      { type: isJpg ? 'image/jpeg' : 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await until(() => [...document.querySelectorAll('img')].some((i) => i.src.startsWith('blob:')), 15000);
    await sleep(350);

    const upd = [...document.querySelectorAll('button')].find((b) => /^\s*Update\s*$/i.test(b.textContent));
    if (!upd) throw new Error('no Update button');
    upd.click();

    if (!await until(onList, 30000)) throw new Error('did not return to the list');

    // The save clears the filter, so search again rather than expecting the
    // row to still be where it was.
    if (!await searchFor(code)) throw new Error('could not re-find the product after saving');
    if (!await until(() => hasThumb(rowFor(code)), 20000)) throw new Error('saved but no thumbnail appeared');

    S.done.push(code);
    console.log('  ok  ', code, Math.round(blob.size / 1024) + 'KB',
      '(' + S.done.length + '/' + CODES.length + ')');
  } catch (e) {
    S.failed.push({ code, why: String(e.message || e) });
    console.warn('  FAIL', code, e.message || e);
    [...document.querySelectorAll('button')].find((b) => /close/i.test(b.textContent))?.click();
    await until(onList, 10000);
  }
};

S.runAll = async () => {
  if (S.running) { console.log('already running'); return; }
  S.running = true; S.stop = false; S.startedAt = S.startedAt || Date.now();
  const todo = CODES.filter((c) => !seen(c));
  console.log('Starting: ' + todo.length + ' of ' + CODES.length + ' products to do');
  try {
    for (const code of todo) {
      if (S.stop) { console.log('stopped by request'); break; }
      await S.processOne(code);
      await sleep(200);
    }
  } finally {
    S.running = false; S.current = null;
    const p = S.progress();
    console.log('%cFinished.', 'font-weight:bold', JSON.stringify(p));
    if (p.failed) console.log('Retry the failures with:  __imgSync.retryFailed()');
    const input = document.querySelector('#product');
    if (input) {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
};

S.retryFailed = async () => {
  const again = S.failed.map((f) => f.code);
  S.failed = [];
  console.log('Retrying ' + again.length + ' failures');
  S.running = true; S.stop = false;
  try {
    for (const code of again) { if (S.stop) break; await S.processOne(code); await sleep(200); }
  } finally { S.running = false; console.log(JSON.stringify(S.progress())); }
};

S.progress = () => ({
  done: S.done.length, failed: S.failed.length, skipped: S.skipped.length,
  total: CODES.length,
  remaining: CODES.filter((c) => !seen(c)).length,
  minutes: S.startedAt ? +(((Date.now() - S.startedAt) / 60000).toFixed(1)) : 0,
  failures: S.failed,
});

console.log('%cvNetra image sync', 'font-weight:bold');
console.log(CODES.length + ' products in this run, matched by product code.');
console.log('Stop anytime with:  __imgSync.stop = true');
S.runAll();
})();
