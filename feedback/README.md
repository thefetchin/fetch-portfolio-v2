# Fetch Feedback — `feedback.thefetch.in`

Signed-QR feedback capture for Fetch Pods. A Cloudflare Worker serves a React
form and writes validated submissions to D1. Deployed separately from the
marketing site, so pushing a form change never redeploys thefetch.in.

```
QR sticker on a Pod
  → https://feedback.thefetch.in/p/POD-MNG-001?t=<hmac>
      → Worker verifies the signature + Turnstile
        → validates + normalises the payload
          → D1
              → /admin (Cloudflare Access) to read it
```

## What the form asks

**Report a problem** — issue type, when it happened, product (optional),
and for payment-related issues: amount, UPI/txn reference, and a refund
request. Contact details are optional *unless* a refund is requested.

**Feedback & requests** — 1–5 rating, what we should stock (multi-select),
a specific brand/item, how pricing feels, how often they use the Pod.

Both tabs share an optional free-text box and contact fields. Target time
to complete: 15–25 seconds.

## Data quality

Every layer assumes the client is lying:

| Control | Where | Effect |
| --- | --- | --- |
| HMAC-signed pod IDs | `worker/index.js` | A guessed or hand-typed pod ID is rejected |
| Turnstile | `worker/index.js` | Blocks scripted submissions |
| Enum whitelists | `worker/validate.js` | Unknown values become `NULL`, never stored raw |
| `CHECK` constraints | `schema.sql` | The DB re-rejects bad enums independently |
| Foreign key on `pod_id` | `schema.sql` | No orphan rows for unknown machines |
| Text normalisation | `worker/validate.js` | Strips control chars/zero-width, collapses whitespace, truncates |
| Money as integer paise | `worker/validate.js` | No floats; absurd amounts rejected |
| Server-side timestamps + UUIDs | `worker/index.js` | Client clocks never trusted |
| Rate limits (6/IP/hr, 40/Pod/hr) | `worker/index.js` | Caps flooding |
| Dedupe hash + `UNIQUE` index | both | Double-taps collapse into one row |
| Honeypot field | form + Worker | Silently discards naive bots |
| IP hashing | `worker/index.js` | Abuse controls without storing raw IPs |

`shared/constants.js` is the single source of truth for every option — the
form renders from it and the Worker validates against it, so the two can't
drift.

## First-time setup

```bash
cd feedback
npm install
```

**1. Create the database**

```bash
npx wrangler d1 create fetch-feedback
```

Copy the printed `database_id` into `wrangler.jsonc`, then apply the schema:

```bash
npm run db:remote     # production
npm run db:local      # local dev copy
```

**2. Register your Pods** — every pod_id in a QR must exist here:

```bash
npx wrangler d1 execute fetch-feedback --remote --command \
  "INSERT INTO pods (pod_id, label, location, city) VALUES
   ('POD-MNG-001','Fetch Pod 001','Lucia Mansion, Kulshekara','Mangalore');"
```

**3. Set the QR signing secret**

```bash
openssl rand -base64 32          # generate — save this somewhere safe
npx wrangler secret put QR_SECRET
```

> Rotating `QR_SECRET` invalidates every QR code already printed. Treat it
> as permanent.

**4. Turnstile** — create a widget at Cloudflare → Turnstile for
`feedback.thefetch.in`. Put the **site key** in `wrangler.jsonc` under
`vars.TURNSTILE_SITE_KEY`, then:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

Until both are set, the bot check is skipped and the form still works.

**5. Deploy**

```bash
npm run deploy
```

Then in the Cloudflare dashboard add `feedback.thefetch.in` as a Custom
Domain for the `fetch-feedback` Worker.

**6. Lock down the dashboard** — Zero Trust → Access → Applications → Add:

- Domain: `feedback.thefetch.in`, path `admin`
- Policy: allow your team's emails
- Copy the **Application Audience (AUD) tag** into `wrangler.jsonc` as
  `ACCESS_AUD`, and your team domain (e.g. `aiumtech.cloudflareaccess.com`)
  as `ACCESS_TEAM_DOMAIN`, then redeploy.

Also add a second Access application covering path `api/admin` so the API
can't be reached directly.

> While `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` are blank the admin API is
> **open**. Set them before the Worker holds real submissions.

## Printing QR codes

```bash
QR_SECRET="<same value as the Worker secret>" npm run qr -- POD-MNG-001 POD-MNG-002
# or from a list
QR_SECRET="..." npm run qr -- --file pods.txt
```

Writes `qr-codes/<POD_ID>.png`, `.svg` and a `urls.csv` manifest. Error
correction is set to H, so the code still scans with a logo over the centre
or with a scuffed sticker.

## Local development

```bash
npm run db:local                 # once
npx wrangler dev --local         # worker + D1 on :8787
npm run dev                      # optional: Vite HMR on :5174, proxies /api
```

Locally, `QR_SECRET` and the Access vars are unset, so signature checks and
admin auth are skipped. Visit:

- `http://localhost:8787/p/POD-MNG-001` — the form
- `http://localhost:8787/admin` — the dashboard

## Layout

```
feedback/
  shared/constants.js     ← options + limits (form AND worker import this)
  worker/
    index.js              ← routes, HMAC, Turnstile, rate limit, dedupe
    validate.js           ← normalisation + whitelisting
    access.js             ← Cloudflare Access JWT verification
  src/                    ← React form + admin dashboard
  scripts/generate-qr.mjs ← signed QR generator
  schema.sql              ← D1 tables, constraints, indexes
```

## Adding a question later

1. Add the option list to `shared/constants.js`.
2. Add a column + `CHECK` constraint in `schema.sql`, apply the migration.
3. Handle it in `validateSubmission()` and the `INSERT` in `worker/index.js`.
4. Render it in `FeedbackForm.jsx`, display it in `Admin.jsx`.

Never rename an existing option `value` — old rows still reference it.
