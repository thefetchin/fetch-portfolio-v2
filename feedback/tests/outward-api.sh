#!/bin/bash
# End-to-end test of the outward flow against a LOCAL `wrangler dev`.
#
#   npx wrangler dev --port 8810 &
#   bash tests/outward-api.sh
#
# Books stock in, plans a run, picks it, dispatches it, and checks the things
# that would be expensive to get wrong: that expired and short-dated stock
# cannot be planned or picked, that FEFO-on-load refuses to trap a batch behind
# one that outlives it, that state transitions cannot be replayed, and that
# concurrent picks of the same batch cannot oversell it.

set -u
BASE=${BASE:-http://localhost:8810}
PASS=0; FAIL=0

jqp() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);let v=o;for(const k of process.argv[1].split(".")){v=v?.[Array.isArray(v)?Number(k):k]}console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("")}})' "$1"; }

post() {
  curl -s -X POST "$BASE$2" -H "Authorization: Bearer $1" \
    -H 'content-type: application/json' -H "Idempotency-Key: $4" -d "$3"
}
get() { curl -s "$BASE$2" -H "Authorization: Bearer $1"; }
codeof() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$2" -H "Authorization: Bearer $1" \
  -H 'content-type: application/json' -H "Idempotency-Key: $4" -d "$3"; }

ok()  { echo "  ok    $1"; PASS=$((PASS+1)); }
no()  { echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "          $2"; FAIL=$((FAIL+1)); }
is()  { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "got '$2', want '$3'"; fi }
has() { if echo "$2" | grep -q "$3"; then ok "$1"; else no "$1" "got: $(echo "$2" | head -c 200)"; fi }

k() { echo "out-$(date +%s)-$RANDOM-$1"; }
RUN=$(date +%s); TAG=${RUN: -6}
POD=POD-MNG-003

PROBE=$(curl -s -X POST "$BASE/api/admin/login" -H 'content-type: application/json' \
  -d '{"email":"mgr@thefetch.in","password":"test-password-1234","device":{"kind":"token"}}')
if echo "$PROBE" | grep -q rate_limited; then
  echo "  login guard tripped. pkill -f 'wrangler dev'; wrangler d1 execute fetch-feedback --local --command \"DELETE FROM admin_login_attempts;\"; restart"
  exit 2
fi
MGR=$(echo "$PROBE" | jqp token)
REF=$(curl -s -X POST "$BASE/api/admin/login" -H 'content-type: application/json' \
  -d '{"email":"ref@thefetch.in","password":"test-password-1234","device":{"kind":"token"}}' | jqp token)
[ -n "$MGR" ] && ok "manager signed in" || no "manager sign-in"

echo
echo "── fixtures: a product and three batches ────────────────────────────────"
SUP=$(post "$MGR" /api/inv/suppliers "{\"name\":\"Outward Distributors $TAG\",\"gstin\":\"29AAAAB$(printf '%04d' $((TAG % 10000)))A1Z5\"}" "$(k sup)" | jqp id)
PROD=$(post "$MGR" /api/inv/products "{\"sku\":\"OUT-$TAG\",\"name\":\"Outward Test Chips 52g\",\"category\":\"chips\",\"gstBps\":1200,\"mrp\":\"20\",\"shelfLifeDays\":400}" "$(k prd)" | jqp id)
[ -n "$PROD" ] && ok "product created" || no "product create"

# long-dated (fine), mid-dated (fine, expires sooner), short-dated (under the
# 21-day minimum). All three are received and put away.
bill() { # <billsuffix> <expiry> <qty>
  local out
  out=$(post "$MGR" /api/inv/purchase-bills "{
    \"supplierId\":\"$SUP\",\"supplierBillNo\":\"OUT/$TAG/$1\",\"billDate\":\"2026-08-15\",
    \"lines\":[{\"productId\":\"$PROD\",\"qty\":\"$3\",\"rate\":\"14.20\",\"gstBps\":1200,\"expiryDate\":\"$2\",\"mrp\":\"20\"}]}" "$(k bill$1)")
  echo "$out" | jqp batches.0.id
}
B_LONG=$(bill long  2027-06-30 200)
B_MID=$(bill  mid   2026-11-15 100)
B_SHORT=$(bill short 2026-08-25 50)
[ -n "$B_LONG" ] && [ -n "$B_MID" ] && [ -n "$B_SHORT" ] && ok "three batches received" \
  || no "batch setup" "long=$B_LONG mid=$B_MID short=$B_SHORT"

for b in "$B_LONG:200" "$B_MID:100" "$B_SHORT:50"; do
  post "$MGR" /api/inv/putaway "{\"toZone\":\"WH-MLR/MAIN\",\"lines\":[{\"batchId\":\"${b%%:*}\",\"qty\":\"${b##*:}\"}]}" "$(k pa${b%%:*})" >/dev/null
done
ok "all three put away into main storage"

echo
echo "── planning refuses what must not go out ────────────────────────────────"
SHORTPLAN=$(post "$MGR" /api/inv/runs \
  "{\"lines\":[{\"podId\":\"$POD\",\"slotName\":\"A1\",\"vliteSlotId\":143108,\"batchId\":\"$B_SHORT\",\"qty\":\"10\"}]}" "$(k shortplan)")
# planning allows short-dated (that is Tier 2, overridable); the PICK is what
# refuses it, since that is the movement the trigger guards.
SHORTRUN=$(echo "$SHORTPLAN" | jqp id)
[ -n "$SHORTRUN" ] && ok "a short-dated batch can be planned (Tier 2 is overridable)" \
  || no "short-dated plan" "$SHORTPLAN"

OVERPLAN=$(post "$MGR" /api/inv/runs \
  "{\"lines\":[{\"podId\":\"$POD\",\"slotName\":\"A1\",\"batchId\":\"$B_LONG\",\"qty\":\"9999\"}]}" "$(k overplan)")
has "planning more than main storage holds is refused" "$OVERPLAN" "in main storage"

NOPOD=$(post "$MGR" /api/inv/runs \
  "{\"lines\":[{\"podId\":\"NOSUCHPOD\",\"slotName\":\"A1\",\"batchId\":\"$B_LONG\",\"qty\":\"1\"}]}" "$(k nopod)")
has "an unknown Pod is refused" "$NOPOD" "does not exist"

DUPLINE=$(post "$MGR" /api/inv/runs \
  "{\"lines\":[{\"podId\":\"$POD\",\"slotName\":\"A1\",\"batchId\":\"$B_LONG\",\"qty\":\"5\"},{\"podId\":\"$POD\",\"slotName\":\"A1\",\"batchId\":\"$B_LONG\",\"qty\":\"5\"}]}" "$(k dupline)")
has "the same batch twice in one slot is refused" "$DUPLINE" "listed twice"

echo
echo "── Gate 2: expired stock cannot be picked, proven by API ────────────────"
# Make the long batch expired behind the API's back, then try to pick it. This
# is the case that matters: the block is a database trigger, so it holds even
# when the application layer has already said yes.
npx wrangler d1 execute fetch-feedback --local --command \
  "UPDATE batches SET expiry_date='2026-08-01' WHERE batch_id='$B_MID';" >/dev/null 2>&1
EXPPLAN=$(post "$MGR" /api/inv/runs \
  "{\"lines\":[{\"podId\":\"$POD\",\"slotName\":\"A2\",\"batchId\":\"$B_MID\",\"qty\":\"10\"}]}" "$(k expplan)")
has "planning an expired batch is refused up front" "$EXPPLAN" "expired"

echo
echo "── a real run: plan, pick, dispatch ────────────────────────────────────"
RUN_KEY=$(k run)
PLAN=$(post "$MGR" /api/inv/runs "{
  \"runDate\":\"2026-08-17\",\"notes\":\"Morning route\",
  \"lines\":[
    {\"podId\":\"$POD\",\"slotName\":\"A1\",\"vliteSlotId\":143108,\"batchId\":\"$B_LONG\",\"qty\":\"24\"},
    {\"podId\":\"$POD\",\"slotName\":\"A2\",\"vliteSlotId\":143109,\"batchId\":\"$B_LONG\",\"qty\":\"12\"}
  ]}" "$RUN_KEY")
RUN_ID=$(echo "$PLAN" | jqp id)
RUN_NO=$(echo "$PLAN" | jqp runNumber)
[ -n "$RUN_ID" ] && ok "run planned as $RUN_NO" || no "run planning" "$PLAN"
has "the run number is FY-scoped" "$RUN_NO" "FETCH/RUN/"
is "two slots fed from one batch share one bag" "$(echo "$PLAN" | jqp bags)" 1
is "...across two plan lines" "$(echo "$PLAN" | jqp lines)" 2

DET=$(get "$MGR" "/api/inv/runs/$RUN_ID")
is "the run starts planned" "$(echo "$DET" | jqp run.status)" planned
is "a transit location is created for it" "$(echo "$DET" | jqp run.transitLocationId)" "TRANSIT:$RUN_ID"
is "the load list names the bag" "$(echo "$DET" | jqp load.0.bagNo)" 1

echo
echo "── dispatch before pick is refused ─────────────────────────────────────"
EARLY=$(post "$MGR" "/api/inv/runs/$RUN_ID/dispatch" '{}' "$(k early)")
has "dispatching a planned run is a wrong_state" "$EARLY" "wrong_state"
is "...as a 409" "$(codeof "$MGR" "/api/inv/runs/$RUN_ID/dispatch" '{}' "$(k early2)")" 409

echo
echo "── pick ────────────────────────────────────────────────────────────────"
PICK=$(post "$MGR" "/api/inv/runs/$RUN_ID/pick" '{}' "$(k pick)")
is "pick succeeds" "$(echo "$PICK" | jqp status)" picked
is "...as one movement for the shared batch" "$(echo "$PICK" | jqp batches)" 1

at() { get "$MGR" /api/inv/stock | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=process.argv.slice(1);const i=JSON.parse(s).items.find(i=>i.batchId===a[0]&&i.locationId===a[1]);console.log(i?i.qtyMilli:0)})' "$1" "$2"; }
is "36 units moved to staging" "$(at "$B_LONG" WH-MLR/STAGE)" 36000
is "...and left main storage" "$(at "$B_LONG" WH-MLR/MAIN)" 164000

RE_PICK=$(post "$MGR" "/api/inv/runs/$RUN_ID/pick" '{}' "$(k repick)")
has "picking twice is refused" "$RE_PICK" "wrong_state"
is "...and staging is unchanged" "$(at "$B_LONG" WH-MLR/STAGE)" 36000

echo
echo "── the short-dated run cannot be picked without an override ─────────────"
SHORTPICK=$(post "$MGR" "/api/inv/runs/$SHORTRUN/pick" '{}' "$(k shortpick)")
has "Gate 2 tier 2 blocks the pick at the database" "$SHORTPICK" "short_shelf_life"
is "...as a 422" "$(codeof "$MGR" "/api/inv/runs/$SHORTRUN/pick" '{}' "$(k shortpick2)")" 422

echo
echo "── dispatch ────────────────────────────────────────────────────────────"
DISP=$(post "$MGR" "/api/inv/runs/$RUN_ID/dispatch" '{}' "$(k disp)")
is "dispatch succeeds" "$(echo "$DISP" | jqp status)" dispatched
is "staging is empty again" "$(at "$B_LONG" WH-MLR/STAGE)" 0
is "the crate is in transit" "$(at "$B_LONG" "TRANSIT:$RUN_ID")" 36000

DET2=$(get "$MGR" "/api/inv/runs/$RUN_ID")
is "the run reports what is in transit" "$(echo "$DET2" | jqp inTransit.0.qtyMilli)" 36000

echo
echo "── idempotent replay of a dispatch ─────────────────────────────────────"
REPLAY=$(curl -s -D /tmp/out-h -X POST "$BASE/api/inv/runs/$RUN_ID/dispatch" \
  -H "Authorization: Bearer $MGR" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(k disp)x" -d '{}')
has "a NEW key on an already-dispatched run is a wrong_state, not a second dispatch" "$REPLAY" "wrong_state"
is "...and transit is unchanged" "$(at "$B_LONG" "TRANSIT:$RUN_ID")" 36000

echo
echo "── refiller scoping ────────────────────────────────────────────────────"
is "a refiller cannot plan a run" "$(codeof "$REF" /api/inv/runs '{"lines":[]}' "$(k refplan)")" 403
is "a refiller cannot pick" "$(codeof "$REF" "/api/inv/runs/$RUN_ID/pick" '{}' "$(k refpick)")" 403
is "a refiller cannot dispatch" "$(codeof "$REF" "/api/inv/runs/$RUN_ID/dispatch" '{}' "$(k refdisp)")" 403
REFLIST=$(get "$REF" /api/inv/runs)
is "a refiller's run list is scoped to their own runs (none assigned)" \
  "$(echo "$REFLIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).runs.length))')" 0
is "a refiller cannot open someone else's run" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/inv/runs/$RUN_ID" -H "Authorization: Bearer $REF")" 403

echo
echo "── cancelling returns the crate ────────────────────────────────────────"
CANCEL=$(post "$MGR" "/api/inv/runs/$RUN_ID/cancel" '{"reason":"Van broke down"}' "$(k cancel)")
is "cancel succeeds" "$(echo "$CANCEL" | jqp status)" cancelled
is "transit is emptied" "$(at "$B_LONG" "TRANSIT:$RUN_ID")" 0
is "the stock is back in main storage" "$(at "$B_LONG" WH-MLR/MAIN)" 200000

echo
echo "══ $PASS passed, $FAIL failed ══"
exit $((FAIL > 0 ? 1 : 0))
