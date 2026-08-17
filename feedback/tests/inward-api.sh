#!/bin/bash
# End-to-end test of the inward flow against a LOCAL `wrangler dev`.
#
#   npx wrangler dev --port 8810 &
#   bash tests/inward-api.sh
#
# Exercises what a manager actually does: create masters, book a supplier bill,
# check the batches and ledger it produced, put stock away, and confirm the
# expiry gate refuses to let bad stock out. Also checks the things that are easy
# to get wrong and invisible in a UI: idempotent replay, role isolation, and the
# expiry sanity checks at goods-in.

set -u
BASE=${BASE:-http://localhost:8810}
PASS=0; FAIL=0

jqp() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const p=process.argv[1].split(".");let v=o;for(const k of p){v=v?.[Array.isArray(v)?Number(k):k]}console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("")}})' "$1"; }

login() {
  curl -s -X POST "$BASE/api/admin/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"test-password-1234\",\"device\":{\"kind\":\"token\"}}" | jqp token
}

# post <token> <path> <json> <idempotency-key>
post() {
  curl -s -X POST "$BASE$2" -H "Authorization: Bearer $1" \
    -H 'content-type: application/json' -H "Idempotency-Key: $4" -d "$3"
}
code() {
  curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$3" -H "Authorization: Bearer $2" \
    ${5:+-H "Idempotency-Key: $5"} -H 'content-type: application/json' ${4:+-d "$4"}
}

ok()   { echo "  ok    $1"; PASS=$((PASS+1)); }
no()   { echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "          $2"; FAIL=$((FAIL+1)); }
is()   { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "got '$2', want '$3'"; fi }
has()  { if echo "$2" | grep -q "$3"; then ok "$1"; else no "$1" "got: $(echo "$2" | head -c 150)"; fi }

k() { echo "test-$(date +%s)-$RANDOM-$1"; }

# Unique per run: suppliers.gstin, products.sku and (supplier, bill no) are all
# UNIQUE, so a fixed fixture would only ever pass once.
RUN=$(date +%s)
TAG=${RUN: -6}
GSTIN="29AAAAA$(printf '%04d' $((TAG % 10000)))A1Z5"
SKU="LAY-MM-$TAG"
BILLNO="MNG/2526/$TAG"

echo "── sign in ─────────────────────────────────────────────────────────────"

# The login endpoint has a brute-force guard: 8 attempts per IP per 15 minutes.
# Three logins a run means repeated runs trip it, and every later assertion then
# fails with a 401 for reasons that have nothing to do with what is being tested.
# Fail fast and say exactly how to clear it instead.
PROBE=$(curl -s -X POST "$BASE/api/admin/login" -H 'content-type: application/json' \
  -d '{"email":"mgr@thefetch.in","password":"test-password-1234","device":{"kind":"token"}}')
if echo "$PROBE" | grep -q rate_limited; then
  cat <<'MSG'

  The login brute-force guard has tripped -- 8 attempts per IP per 15 minutes.
  That is the guard working, not a bug. Clear it and re-run:

    pkill -f 'wrangler dev'
    npx wrangler d1 execute fetch-feedback --local --command "DELETE FROM admin_login_attempts;"
    npx wrangler dev --port 8810 &

MSG
  exit 2
fi

ADMIN=$(login test@thefetch.in)
MGR=$(echo "$PROBE" | jqp token)
REF=$(login ref@thefetch.in)
[ -n "$ADMIN" ] && ok "admin signed in" || no "admin sign-in"
[ -n "$MGR" ]   && ok "inventory manager signed in" || no "manager sign-in"
[ -n "$REF" ]   && ok "refiller signed in" || no "refiller sign-in"

echo
echo "── role isolation on /api/inv/* ────────────────────────────────────────"
is "refiller cannot read stock"            "$(code GET "$REF" /api/inv/stock)" 403
is "refiller cannot read suppliers"        "$(code GET "$REF" /api/inv/suppliers)" 403
is "refiller cannot read purchase bills"   "$(code GET "$REF" /api/inv/purchase-bills)" 403
is "manager CAN read stock"                "$(code GET "$MGR" /api/inv/stock)" 200
is "manager CAN read purchase bills"       "$(code GET "$MGR" /api/inv/purchase-bills)" 200
is "products are readable by every role"   "$(code GET "$REF" /api/inv/products)" 200

echo
echo "── idempotency is mandatory ────────────────────────────────────────────"
NOKEY=$(curl -s -X POST "$BASE/api/inv/suppliers" -H "Authorization: Bearer $MGR" \
  -H 'content-type: application/json' -d '{"name":"No Key Ltd"}')
has "a POST without an Idempotency-Key is refused" "$NOKEY" "idempotency_required"

echo
echo "── masters ─────────────────────────────────────────────────────────────"
SUP=$(post "$MGR" /api/inv/suppliers \
  "{\"name\":\"Mangalore Distributors $TAG\",\"gstin\":\"$GSTIN\",\"address\":\"Kankanady, Mangalore\"}" "$(k sup)")
SUP_ID=$(echo "$SUP" | jqp id)
[ -n "$SUP_ID" ] && ok "supplier created ($SUP_ID)" || no "supplier create" "$SUP"

BADGST=$(post "$MGR" /api/inv/suppliers '{"name":"Bad GST","gstin":"NOTAGSTIN"}' "$(k badgst)")
has "an invalid GSTIN is refused" "$BADGST" "GSTIN is not valid"

PROD=$(post "$MGR" /api/inv/products \
  "{\"sku\":\"$SKU\",\"name\":\"Lays Magic Masala 52g\",\"category\":\"chips\",\"uom\":\"pcs\",\"gstBps\":1200,\"mrp\":\"20\",\"shelfLifeDays\":120,\"hsn\":\"2005\"}" "$(k prd)")
PROD_ID=$(echo "$PROD" | jqp id)
[ -n "$PROD_ID" ] && ok "product created ($PROD_ID)" || no "product create" "$PROD"

BADCAT=$(post "$MGR" /api/inv/products '{"sku":"X","name":"X","category":"spaceships"}' "$(k badcat)")
has "an unknown category is refused" "$BADCAT" "valid product category"

echo
echo "── expiry sanity checks at goods-in ────────────────────────────────────"
NOEXP=$(post "$MGR" /api/inv/purchase-bills \
  "{\"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"NOEXP-1\",\"billDate\":\"2026-08-15\",\"lines\":[{\"productId\":\"$PROD_ID\",\"qty\":\"10\",\"rate\":\"14.20\",\"gstBps\":1200}]}" "$(k noexp)")
has "a line with no expiry date is refused" "$NOEXP" "no expiry, no batch"

# 120-day shelf life; 2 years out is far beyond 1.5x, so it reads as a typo
TYPO=$(post "$MGR" /api/inv/purchase-bills \
  "{\"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"TYPO-1\",\"billDate\":\"2026-08-15\",\"lines\":[{\"productId\":\"$PROD_ID\",\"qty\":\"10\",\"rate\":\"14.20\",\"expiryDate\":\"2028-12-10\"}]}" "$(k typo)")
has "an expiry beyond the shelf life is refused as a likely typo" "$TYPO" "Check the year"

PAST=$(post "$MGR" /api/inv/purchase-bills \
  "{\"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"PAST-1\",\"billDate\":\"2026-08-15\",\"lines\":[{\"productId\":\"$PROD_ID\",\"qty\":\"10\",\"rate\":\"14.20\",\"expiryDate\":\"2026-08-01\"}]}" "$(k past)")
has "stock already expired on the bill date is refused" "$PAST" "already expired"

FUTURE=$(post "$MGR" /api/inv/purchase-bills \
  "{\"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"FUT-1\",\"billDate\":\"2027-01-01\",\"lines\":[{\"productId\":\"$PROD_ID\",\"qty\":\"10\",\"rate\":\"14.20\",\"expiryDate\":\"2027-04-01\"}]}" "$(k fut)")
has "a future bill date is refused" "$FUTURE" "cannot be in the future"

echo
echo "── booking a real bill ─────────────────────────────────────────────────"
BILL_KEY=$(k bill)
BILL=$(post "$MGR" /api/inv/purchase-bills "{
  \"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"$BILLNO\",\"billDate\":\"2026-08-15\",
  \"freight\":\"240\",
  \"lines\":[
    {\"productId\":\"$PROD_ID\",\"qty\":\"240\",\"freeQty\":\"24\",\"rate\":\"14.20\",\"gstBps\":1200,\"expiryDate\":\"2026-12-10\",\"mrp\":\"20\",\"supplierBatchNo\":\"L2291\"}
  ]}" "$BILL_KEY")
GRN=$(echo "$BILL" | jqp grnNumber)
BILL_ID=$(echo "$BILL" | jqp id)
BATCH_ID=$(echo "$BILL" | jqp batches.0.id)
BATCH_CODE=$(echo "$BILL" | jqp batches.0.code)
UNIT_COST=$(echo "$BILL" | jqp batches.0.unitCostPaise)
QTY=$(echo "$BILL" | jqp batches.0.qtyMilli)

[ -n "$GRN" ] && ok "bill booked as $GRN" || no "bill booking" "$BILL"
has "the GRN number is FY-scoped" "$GRN" "FETCH/GRN/"
is "free goods are received too (240 + 24 = 264 units)" "$QTY" 264000
# 240 units at Rs 14.20 = 340,800 paise taxable, plus Rs 240 freight = 364,800,
# spread over the 264 units actually received (240 paid + 24 free):
# 364800 * 1000 / 264000 = 1381.8 -> 1382 paise, i.e. Rs 13.82 a unit.
# Note it is BELOW the Rs 14.20 invoice rate despite the freight, because the
# free goods dilute more than the freight adds.
is "unit cost dilutes over paid + free goods, and includes freight" "$UNIT_COST" 1382
[ -n "$BATCH_CODE" ] && ok "batch code allocated ($BATCH_CODE)" || no "batch code"

echo
echo "── the same bill cannot be booked twice ────────────────────────────────"
DUP=$(post "$MGR" /api/inv/purchase-bills "{
  \"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"$BILLNO\",\"billDate\":\"2026-08-15\",
  \"lines\":[{\"productId\":\"$PROD_ID\",\"qty\":\"1\",\"rate\":\"1\",\"expiryDate\":\"2026-12-10\"}]}" "$(k dup)")
has "a duplicate supplier bill number is refused" "$DUP" "already been booked"

echo
echo "── idempotent replay ───────────────────────────────────────────────────"
REPLAY=$(curl -s -D /tmp/inv-h -X POST "$BASE/api/inv/purchase-bills" \
  -H "Authorization: Bearer $MGR" -H 'content-type: application/json' \
  -H "Idempotency-Key: $BILL_KEY" -d "{
  \"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"$BILLNO\",\"billDate\":\"2026-08-15\",
  \"freight\":\"240\",
  \"lines\":[
    {\"productId\":\"$PROD_ID\",\"qty\":\"240\",\"freeQty\":\"24\",\"rate\":\"14.20\",\"gstBps\":1200,\"expiryDate\":\"2026-12-10\",\"mrp\":\"20\",\"supplierBatchNo\":\"L2291\"}
  ]}")
is "replaying the same key returns the original GRN" "$(echo "$REPLAY" | jqp grnNumber)" "$GRN"
has "...and says so in a header" "$(cat /tmp/inv-h)" "idempotency-replayed: true"

MISMATCH=$(post "$MGR" /api/inv/purchase-bills \
  "{\"supplierId\":\"$SUP_ID\",\"supplierBillNo\":\"DIFFERENT\",\"billDate\":\"2026-08-15\",\"lines\":[{\"productId\":\"$PROD_ID\",\"qty\":\"1\",\"rate\":\"1\",\"expiryDate\":\"2026-12-10\"}]}" "$BILL_KEY")
has "the same key with a different body is refused" "$MISMATCH" "idempotency_mismatch"

echo
echo "── the bill landed in receiving, not in pickable storage ────────────────"
STOCK=$(curl -s -H "Authorization: Bearer $MGR" "$BASE/api/inv/stock")
# Assert on THIS batch, not on zone totals: other fixtures share the warehouse.
at() { echo "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=process.argv.slice(1);const i=JSON.parse(s).items.find(i=>i.batchId===a[0]&&i.locationId===a[1]);console.log(i?i.qtyMilli:0)})' "$2" "$3"; }
is "264 units of this batch are in receiving" "$(at "$STOCK" "$BATCH_ID" WH-MLR/RECV)" 264000
is "none of it is in main storage yet"        "$(at "$STOCK" "$BATCH_ID" WH-MLR/MAIN)" 0

echo
echo "── scanning the batch sticker ──────────────────────────────────────────"
LOOK=$(curl -s -H "Authorization: Bearer $MGR" "$BASE/api/inv/batches/lookup?code=$BATCH_CODE")
is "the code resolves to a batch" "$(echo "$LOOK" | jqp match)" batch
is "...with its expiry" "$(echo "$LOOK" | jqp batch.expiryDate)" 2026-12-10
is "...and is not expired" "$(echo "$LOOK" | jqp batch.expired)" false
LOWER=$(curl -s -H "Authorization: Bearer $MGR" "$BASE/api/inv/batches/lookup?code=$(echo "$BATCH_CODE" | tr 'A-Z' 'a-z')")
is "lowercase scans resolve too" "$(echo "$LOWER" | jqp match)" batch
BADCODE=$(curl -s -H "Authorization: Bearer $MGR" "$BASE/api/inv/batches/lookup?code=B99999")
has "a code failing its check character is rejected" "$BADCODE" "unknown_code"

echo
echo "── putaway ─────────────────────────────────────────────────────────────"
BADPUT=$(post "$MGR" /api/inv/putaway \
  "{\"toZone\":\"WH-MLR/RECV\",\"lines\":[{\"batchId\":\"$BATCH_ID\",\"qty\":\"10\"}]}" "$(k badput)")
has "putting away back into receiving is refused" "$BADPUT" "already in receiving"

OVERPUT=$(post "$MGR" /api/inv/putaway \
  "{\"toZone\":\"WH-MLR/MAIN\",\"lines\":[{\"batchId\":\"$BATCH_ID\",\"qty\":\"9999\"}]}" "$(k overput)")
has "putting away more than arrived is refused" "$OVERPUT" "is in receiving"

PUT=$(post "$MGR" /api/inv/putaway \
  "{\"toZone\":\"WH-MLR/MAIN\",\"lines\":[{\"batchId\":\"$BATCH_ID\",\"qty\":\"264\"}]}" "$(k put)")
is "putaway succeeds" "$(echo "$PUT" | jqp ok)" true

STOCK2=$(curl -s -H "Authorization: Bearer $MGR" "$BASE/api/inv/stock")
is "this batch has left receiving"     "$(at "$STOCK2" "$BATCH_ID" WH-MLR/RECV)" 0
is "...and is all in main storage now"  "$(at "$STOCK2" "$BATCH_ID" WH-MLR/MAIN)" 264000

echo
echo "── write-offs ──────────────────────────────────────────────────────────"
WO=$(post "$MGR" /api/inv/write-offs \
  "{\"batchId\":\"$BATCH_ID\",\"locationId\":\"WH-MLR/MAIN\",\"qty\":\"4\",\"reason\":\"damaged\",\"notes\":\"Crushed in transit\",\"supplierClaim\":true}" "$(k wo)")
has "a write-off is numbered" "$(echo "$WO" | jqp woNumber)" "FETCH/WO/"
is "...and valued at batch cost (4 x 1382)" "$(echo "$WO" | jqp valuePaise)" 5528
is "...and flagged as a supplier claim" "$(echo "$WO" | jqp supplierClaim)" true

OVERWO=$(post "$MGR" /api/inv/write-offs \
  "{\"batchId\":\"$BATCH_ID\",\"locationId\":\"WH-MLR/MAIN\",\"qty\":\"99999\",\"reason\":\"damaged\"}" "$(k overwo)")
has "writing off more than is there is refused" "$OVERWO" "insufficient_stock"

echo
echo "── expiry report ───────────────────────────────────────────────────────"
EXP=$(curl -s -H "Authorization: Bearer $MGR" "$BASE/api/inv/reports/expiry?withinDays=365")
has "the batch appears in the expiry report" "$EXP" "$BATCH_CODE"

echo
echo "══ $PASS passed, $FAIL failed ══"
exit $((FAIL > 0 ? 1 : 0))
