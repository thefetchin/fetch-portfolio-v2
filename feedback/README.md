# Fetch Feedback — `feedback.thefetch.in`

Signed-QR feedback capture for Fetch Pods. One Cloudflare Worker serves two
custom domains — the public form on `feedback.thefetch.in` and the
password-protected dashboard on `admin.thefetch.in` — writing validated
submissions to D1. Deployed separately from the marketing site, so pushing a
form change never redeploys thefetch.in.

```
QR sticker on a Pod
  → https://feedback.thefetch.in/p/POD-MNG-001?t=<hmac>
      → Worker verifies the signature + Turnstile
        → validates + normalises the payload
          → D1
              → admin.thefetch.in (email+password login) to read it
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

**6. Create your dashboard login**

Auth is email + password stored in D1 — no Cloudflare Access needed.
Apply the auth migration once:

```bash
npm run db:auth
```

Then create a login. The password is typed on your machine, hashed locally,
and only the hash is sent to the database:

```bash
npm run admin:create -- you@thefetch.in
```

Re-running for the same email rotates that password and kills existing
sessions. Add as many logins as you need.

### How the auth works

| Concern | Handling |
| --- | --- |
| Password storage | PBKDF2-SHA256, per-user random salt, self-describing hash (`pbkdf2$sha256$<iters>$<salt>$<hash>`). Plaintext is never stored or transmitted anywhere but the login POST. |
| Iteration count | `PBKDF2_ITERATIONS` in `shared/constants.js` — 25,000, sized to the Workers **free plan** 10ms CPU budget. On Workers Paid raise it to 210,000 and re-run `admin:create` per user. |
| Sessions | 32 random bytes in an `HttpOnly; Secure; SameSite=Lax` cookie, 7-day expiry. The DB stores only a SHA-256 of the token, so a database leak can't be replayed as a live session. |
| Brute force | 8 attempts per IP per 15 minutes, tracked in `admin_login_attempts`. |
| User enumeration | Unknown emails and wrong passwords return the identical message, and a dummy hash is computed so response timing matches. |
| Revocation | `DELETE FROM admin_sessions WHERE user_id = …`, or set `admin_users.active = 0`. |

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

Locally, `QR_SECRET` is unset so signature checks are skipped. Create a
local login and sign in exactly as in production:

```bash
npm run db:local                        # base schema
npx wrangler d1 execute fetch-feedback --local --file=./migrations/002_admin_auth.sql
npm run admin:create -- you@thefetch.in --local
```

Because production splits the two surfaces across subdomains but local dev
has one origin, put this in `.dev.vars` (gitignored) so the local host acts
as the admin host:

```
ADMIN_HOSTNAME="feedback.thefetch.in"
```

Visit:

- `http://localhost:8787/p/POD-MNG-001` — the form
- `http://localhost:8787/admin` — the dashboard

## Layout

```
feedback/
  shared/constants.js     ← options + limits (form AND worker import this)
  worker/
    index.js              ← routes, host split, HMAC, Turnstile, rate limits
    validate.js           ← normalisation + whitelisting
    auth.js               ← password hashing, sessions, login/logout
  src/                    ← React form + admin dashboard (+ login)
  scripts/
    generate-qr.mjs       ← signed QR generator
    create-admin.mjs      ← creates/rotates dashboard logins
  schema.sql              ← D1 tables, constraints, indexes
  migrations/
    002_admin_auth.sql    ← admin_users / admin_sessions / login attempts
```

## Adding a question later

1. Add the option list to `shared/constants.js`.
2. Add a column + `CHECK` constraint in `schema.sql`, apply the migration.
3. Handle it in `validateSubmission()` and the `INSERT` in `worker/index.js`.
4. Render it in `FeedbackForm.jsx`, display it in `Admin.jsx`.

Never rename an existing option `value` — old rows still reference it.
