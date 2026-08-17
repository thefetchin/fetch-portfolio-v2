#!/bin/bash
# Concurrent picks of the same batch, through the real API.
#
#   npx wrangler dev --port 8810 &
#   bash tests/concurrency-api.sh
#
# D1 has no interactive transactions, so nothing in the application layer can
# make "check availability, then take it" atomic. The guarantee comes from the
# database instead: the balance carries CHECK (qty_milli >= floor_milli), so a
# losing writer breaches it, which aborts the statement, which rolls back the
# whole batch.
#
# The assertion that matters is the LAST one. An earlier design used a
# conditional UPDATE plus a changes() check; that would have COMMITTED the batch
# and left the movement rows behind with the balance unmoved -- manufacturing
# exactly the drift the ledger exists to prevent. So it is not enough that the
# balance is right: the losers must leave nothing at all.

set -u
BASE=${BASE:-http://localhost:8810}
N=${N:-6}
PASS=0; FAIL=0

jqp() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);let v=o;for(const k of process.argv[1].split(".")){v=v?.[Array.isArray(v)?Number(k):k]}console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("")}})' "$1"; }
post() { curl -s -X POST "$BASE$2" -H "Authorization: Bearer $1" -H 'content-type: application/json' -H "Idempotency-Key: $4" -d "$3"; }
ok()  { echo "  ok    $1"; PASS=$((PASS+1)); }
no()  { echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "          $2"; FAIL=$((FAIL+1)); }
is()  { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "got '$2', want '$3'"; fi }
k()   { echo "conc-$(date +%s)-$RANDOM-$1"; }

RUN=$(date +%s); TAG=${RUN: -6}
POD=POD-MNG-003

PROBE=$(curl -s -X POST "$BASE/api/admin/login" -H 'content-type: application/json' \
  -d '{"email":"mgr@thefetch.in","password":"test-password-1234","device":{"kind":"token"}}')
echo "$PROBE" | grep -q rate_limited && { echo "  login guard tripped; clear admin_login_attempts and restart"; exit 2; }
MGR=$(echo "$PROBE" | jqp token)

echo "── setup: 30 units, and $N runs each wanting 20 ────────────────────────"
SUP=$(post "$MGR" /api/inv/suppliers "{\"name\":\"Concurrency Co $TAG\",\"gstin\":\"29AAAAC$(printf '%04d' $((TAG % 10000)))A1Z5\"}" "$(k sup)" | jqp id)
PROD=$(post "$MGR" /api/inv/products "{\"sku\":\"CONC-$TAG\",\"name\":\"Concurrency Test Item\",\"category\":\"chips\",\"gstBps\":1200,\"shelfLifeDays\":400}" "$(k prd)" | jqp id)
BATCH=$(post "$MGR" /api/inv/purchase-bills "{
  \"supplierId\":\"$SUP\",\"supplierBillNo\":\"CONC/$TAG\",\"billDate\":\"2026-08-15\",
  \"lines\":[{\"productId\":\"$PROD\",\"qty\":\"30\",\"rate\":\"10\",\"gstBps\":1200,\"expiryDate\":\"2027-06-30\"}]}" "$(k bill)" | jqp batches.0.id)
post "$MGR" /api/inv/putaway "{\"toZone\":\"WH-MLR/MAIN\",\"lines\":[{\"batchId\":\"$BATCH\",\"qty\":\"30\"}]}" "$(k pa)" >/dev/null
[ -n "$BATCH" ] && ok "30 units of $BATCH in main storage" || { no "setup"; exit 1; }

# Plan N separate runs, each for 20 units. Only one can succeed: 20 + 20 > 30.
RUN_IDS=()
for i in $(seq 1 "$N"); do
  rid=$(post "$MGR" /api/inv/runs \
    "{\"lines\":[{\"podId\":\"$POD\",\"slotName\":\"C$i\",\"batchId\":\"$BATCH\",\"qty\":\"20\"}]}" "$(k plan$i)" | jqp id)
  RUN_IDS+=("$rid")
done
is "$N runs planned (planning is advisory, so all succeed)" "${#RUN_IDS[@]}" "$N"

echo
echo "── firing $N picks at once ──────────────────────────────────────────────"
rm -f /tmp/conc-*.out
i=0
for rid in "${RUN_IDS[@]}"; do
  i=$((i+1))
  (
    body=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/inv/runs/$rid/pick" \
      -H "Authorization: Bearer $MGR" -H 'content-type: application/json' \
      -H "Idempotency-Key: $(k pick$i)" -d '{}')
    echo "$body" > "/tmp/conc-$i.out"
  ) &
done
wait

SUCCESS=0; CONFLICT=0; OTHER=0
for f in /tmp/conc-*.out; do
  code=$(tail -1 "$f")
  case "$code" in
    200) SUCCESS=$((SUCCESS+1)) ;;
    409) CONFLICT=$((CONFLICT+1)) ;;
    *)   OTHER=$((OTHER+1)); echo "          unexpected $code: $(head -1 "$f" | head -c 120)" ;;
  esac
done
echo "          $SUCCESS succeeded, $CONFLICT conflicted, $OTHER other"

is "exactly one pick succeeded" "$SUCCESS" 1
is "the rest were refused as conflicts" "$CONFLICT" "$((N - 1))"
is "nothing failed for an unexpected reason" "$OTHER" 0
grep -l "insufficient_stock" /tmp/conc-*.out >/dev/null 2>&1 \
  && ok "the losers were told the stock had gone, in plain words" \
  || no "loser message" "expected insufficient_stock in at least one response"

echo
echo "── the ledger survived it ──────────────────────────────────────────────"
STOCK=$(curl -s "$BASE/api/inv/stock" -H "Authorization: Bearer $MGR")
at() { echo "$STOCK" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=process.argv.slice(1);const i=JSON.parse(s).items.find(i=>i.batchId===a[0]&&i.locationId===a[1]);console.log(i?i.qtyMilli:0)})' "$1" "$2"; }
is "20 units are staged, not 40 or more" "$(at "$BATCH" WH-MLR/STAGE)" 20000
is "10 units remain in main storage" "$(at "$BATCH" WH-MLR/MAIN)" 10000

echo
echo "── and the losers left NOTHING behind ──────────────────────────────────"
echo "     (the assertion that catches a conditional-UPDATE design)"
sleep 1
pkill -f "wrangler dev" >/dev/null 2>&1; sleep 2   # release the SQLite write lock

q() { npx wrangler d1 execute fetch-feedback --local --json --command "$1" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s)[0].results;console.log(r.length?Object.values(r[0])[0]:0)}catch(e){console.log("ERR")}})'; }

is "exactly one pick movement pair exists for this batch" \
  "$(q "SELECT COUNT(*) FROM stock_movements WHERE batch_id='$BATCH' AND reason='pick'")" 2

is "no balance for this batch went negative" \
  "$(q "SELECT COUNT(*) FROM stock_balances sb JOIN locations l ON l.location_id=sb.location_id WHERE sb.batch_id='$BATCH' AND l.allow_negative=0 AND sb.qty_milli<0")" 0

is "balances still equal the sum of their movements" \
  "$(q "WITH d AS (SELECT location_id,batch_id,SUM(qty_milli) q FROM stock_movements GROUP BY 1,2)
        SELECT COUNT(*) FROM stock_balances b LEFT JOIN d ON d.location_id=b.location_id AND d.batch_id=b.batch_id
         WHERE b.qty_milli <> COALESCE(d.q,0)")" 0

is "every ref_id is still a balanced two-leg entry" \
  "$(q "SELECT COUNT(*) FROM (SELECT ref_id FROM stock_movements GROUP BY ref_id
         HAVING COUNT(*)<>2 OR SUM(qty_milli)<>0 OR COUNT(DISTINCT batch_id)<>1)")" 0

is "every batch still nets to zero across all locations" \
  "$(q "SELECT COUNT(*) FROM (SELECT batch_id FROM stock_movements GROUP BY batch_id HAVING SUM(qty_milli)<>0)")" 0

is "only one run reached 'picked'" \
  "$(q "SELECT COUNT(*) FROM refill_runs WHERE status='picked' AND run_id IN ($(printf "'%s'," "${RUN_IDS[@]}" | sed 's/,$//'))")" 1

rm -f /tmp/conc-*.out
echo
echo "══ $PASS passed, $FAIL failed ══"
echo "  (wrangler dev was stopped to read the database; restart it for other suites)"
exit $((FAIL > 0 ? 1 : 0))
