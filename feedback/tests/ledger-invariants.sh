#!/bin/bash
# Ledger invariant tests for migrations/004_inventory.sql, against the LOCAL D1.
#
# Each case asserts either that a statement succeeds, or that it aborts with a
# specific error code -- the point being that the guarantees live in the
# database, so they hold for the dashboard, the API, the Cron job and a
# hand-run `wrangler d1 execute` alike.
#
#   bash tests/ledger-invariants.sh
#
# LOCAL ONLY. It wipes the ledger. Never point it at --remote.
#
# Stop `wrangler dev` first: both processes want a write lock on the same
# SQLite file and workerd dies with SQLITE_BUSY if they overlap.

set -u
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$TESTS_DIR/.." || exit 1          # the feedback/ project root

PASS=0; FAIL=0

# Always start from a known state. stock_movements is append-only, so the reset
# lifts the guards, wipes, and puts them straight back -- local only.
npx wrangler d1 execute fetch-feedback --local --file "$TESTS_DIR/reset-local.sql" >/dev/null 2>&1
npx wrangler d1 execute fetch-feedback --local --file "$TESTS_DIR/seed-local.sql"  >/dev/null 2>&1

run() { npx wrangler d1 execute fetch-feedback --local --command "$1" 2>&1; }

# expect_ok <name> <sql>
expect_ok() {
  local name="$1" sql="$2" out
  out=$(run "$sql")
  if echo "$out" | grep -q "executed successfully"; then
    echo "  ok    $name"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name — expected success"
    echo "$out" | grep -iE "error|abort" | head -2 | sed 's/^/          /'
    FAIL=$((FAIL+1))
  fi
}

# expect_abort <name> <needle> <sql>
expect_abort() {
  local name="$1" needle="$2" sql="$3" out
  out=$(run "$sql")
  if echo "$out" | grep -q "$needle"; then
    echo "  ok    $name  (blocked: $needle)"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name — expected abort containing '$needle'"
    echo "$out" | grep -iE "error|abort|successfully" | head -2 | sed 's/^/          /'
    FAIL=$((FAIL+1))
  fi
}

# A double entry: two legs, one ref_id, one batch, summing to zero.
leg2() {
  local ref="$1" reason="$2" from="$3" to="$4" batch="$5" qty="$6" extra="${7:-}"
  echo "INSERT INTO stock_movements
          (movement_id, ref_id, ref_type, leg, location_id, batch_id, product_id,
           qty_milli, reason, unit_cost_paise, value_paise, created_by ${extra:+, override_id})
        VALUES
          ('${ref}-c', '${ref}', 'purchase_bill', 'credit', '${from}', '${batch}', 'prd_t1',
           -${qty}, '${reason}', 1420, -${qty}, 'test@thefetch.in' ${extra:+, ${extra}}),
          ('${ref}-d', '${ref}', 'purchase_bill', 'debit',  '${to}',   '${batch}', 'prd_t1',
            ${qty}, '${reason}', 1420,  ${qty}, 'test@thefetch.in' ${extra:+, ${extra}});"
}

echo
echo "── happy path ─────────────────────────────────────────────────────────"
expect_ok "purchase_in  X-SUPP -> RECV   (240 units)" \
  "$(leg2 ref-in1 purchase_in X-SUPP WH-MLR/RECV btc_good 240000)"
expect_ok "putaway      RECV   -> MAIN" \
  "$(leg2 ref-pa1 putaway WH-MLR/RECV WH-MLR/MAIN btc_good 240000)"
expect_ok "pick         MAIN   -> STAGE  (36 units)" \
  "$(leg2 ref-pk1 pick WH-MLR/MAIN WH-MLR/STAGE btc_good 36000)"
expect_ok "dispatch     STAGE  -> POD" \
  "$(leg2 ref-dp1 dispatch WH-MLR/STAGE POD:TESTPOD btc_good 36000)"
expect_ok "consumed     POD    -> X-SOLD (15 units sold)" \
  "$(leg2 ref-sl1 consumed POD:TESTPOD X-SOLD btc_good 15000)"

echo
echo "── invariant 3: no real location goes negative ─────────────────────────"
expect_abort "over-pick 500 units when MAIN holds 204" "CHECK constraint failed: qty_milli >= floor_milli" \
  "$(leg2 ref-bad1 pick WH-MLR/MAIN WH-MLR/STAGE btc_good 500000)"

# The assertion that catches the design this replaced. A conditional
# `UPDATE ... WHERE qty >= n` plus a changes() check would COMMIT the batch and
# leave the movement rows behind with the balance unmoved -- which is precisely
# the drift the ledger exists to prevent. Breaching the CHECK rolls the whole
# batch back instead, so the loser leaves nothing at all.
orphans=$(npx wrangler d1 execute fetch-feedback --local --json --command \
  "SELECT COUNT(*) AS n FROM stock_movements WHERE ref_id = 'ref-bad1';" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')
if [ "$orphans" = "0" ]; then
  echo "  ok    the refused over-pick left no movement rows behind"; PASS=$((PASS+1))
else
  echo "  FAIL  the refused over-pick left $orphans orphan movement row(s)"; FAIL=$((FAIL+1))
fi

echo
echo "── invariant 4: expiry gates ──────────────────────────────────────────"
expect_ok    "expired batch may be RECEIVED" \
  "$(leg2 ref-in2 purchase_in X-SUPP WH-MLR/MAIN btc_exp 100000)"
expect_abort "expired batch cannot be PICKED" "expired_batch" \
  "$(leg2 ref-bad2 pick WH-MLR/MAIN WH-MLR/STAGE btc_exp 10000)"
expect_abort "expired batch cannot be DISPATCHED" "expired_batch" \
  "$(leg2 ref-bad3 dispatch WH-MLR/STAGE POD:TESTPOD btc_exp 10000)"
expect_abort "expired batch cannot be REFILLED into a Pod" "expired_batch" \
  "$(leg2 ref-bad4 refill WH-MLR/STAGE POD:TESTPOD btc_exp 10000)"
expect_ok    "expired batch CAN be written off (lawful exit)" \
  "$(leg2 ref-wo1 writeoff WH-MLR/MAIN SCRAP btc_exp 10000)"
expect_ok    "expired batch CAN be returned to the supplier" \
  "$(leg2 ref-pr1 purchase_return WH-MLR/MAIN X-SUPP btc_exp 10000)"

echo
echo "── invariant 4 tier 2: minimum shelf life ─────────────────────────────"
expect_ok    "short-dated batch may be received" \
  "$(leg2 ref-in3 purchase_in X-SUPP WH-MLR/MAIN btc_short 50000)"
expect_abort "short-dated batch cannot be picked without an override" "short_shelf_life" \
  "$(leg2 ref-bad5 pick WH-MLR/MAIN WH-MLR/STAGE btc_short 5000)"

echo
echo "── quarantine (recall) ────────────────────────────────────────────────"
expect_ok    "quarantined batch may be received" \
  "$(leg2 ref-in4 purchase_in X-SUPP WH-MLR/MAIN btc_quar 60000)"
expect_abort "quarantined batch cannot be picked" "batch_not_active" \
  "$(leg2 ref-bad6 pick WH-MLR/MAIN WH-MLR/STAGE btc_quar 5000)"

echo
echo "── invariant 5: only pickable zones supply a run ───────────────────────"
expect_abort "cannot pick out of RECV" "not_pickable" \
  "$(leg2 ref-bad7 pick WH-MLR/RECV WH-MLR/STAGE btc_good 1000)"
expect_abort "cannot pick out of QUAR" "not_pickable" \
  "$(leg2 ref-bad8 pick WH-MLR/QUAR WH-MLR/STAGE btc_good 1000)"
expect_abort "cannot pick out of EXPIRED" "not_pickable" \
  "$(leg2 ref-bad9 pick WH-MLR/EXPIRED WH-MLR/STAGE btc_good 1000)"

echo
echo "── invariant 1: append-only ───────────────────────────────────────────"
expect_abort "UPDATE a movement" "append-only" \
  "UPDATE stock_movements SET qty_milli = 1 WHERE movement_id = 'ref-in1-d';"
expect_abort "DELETE a movement" "append-only" \
  "DELETE FROM stock_movements WHERE movement_id = 'ref-in1-d';"

echo
echo "── the three reconciliation queries (each MUST return zero rows) ───────"
recon() {
  local name="$1" sql="$2" n
  n=$(npx wrangler d1 execute fetch-feedback --local --json --command "$sql" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[0].results.length)}catch(e){console.log("ERR")}})')
  if [ "$n" = "0" ]; then echo "  ok    $name — 0 rows"; PASS=$((PASS+1));
  else echo "  FAIL  $name — $n row(s)"; FAIL=$((FAIL+1)); fi
}
recon "(1) balances equal the sum of their movements" \
"WITH derived AS (SELECT location_id, batch_id, SUM(qty_milli) q FROM stock_movements GROUP BY 1,2)
 SELECT b.location_id, b.batch_id, b.qty_milli, COALESCE(d.q,0) FROM stock_balances b
   LEFT JOIN derived d ON d.location_id=b.location_id AND d.batch_id=b.batch_id
  WHERE b.qty_milli <> COALESCE(d.q,0)
 UNION ALL
 SELECT d.location_id, d.batch_id, 0, d.q FROM derived d
   LEFT JOIN stock_balances b ON b.location_id=d.location_id AND b.batch_id=d.batch_id
  WHERE b.location_id IS NULL AND d.q <> 0;"

recon "(2) every ref_id is a balanced two-leg entry" \
"SELECT ref_id FROM stock_movements GROUP BY ref_id
  HAVING COUNT(*) <> 2 OR SUM(qty_milli) <> 0 OR COUNT(DISTINCT batch_id) <> 1;"

recon "(3) every batch nets to zero across all locations" \
"SELECT batch_id, SUM(qty_milli) FROM stock_movements GROUP BY batch_id HAVING SUM(qty_milli) <> 0;"

echo
echo "── closing balances ───────────────────────────────────────────────────"
npx wrangler d1 execute fetch-feedback --local --json --command \
"SELECT sb.location_id, b.batch_code, sb.qty_milli/1000.0 AS qty
   FROM stock_balances sb JOIN batches b ON b.batch_id=sb.batch_id
  WHERE sb.qty_milli <> 0 ORDER BY sb.location_id, b.batch_code" 2>/dev/null \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const r of JSON.parse(s)[0].results)console.log("   ",String(r.location_id).padEnd(16),String(r.batch_code).padEnd(8),r.qty)})'

echo
echo "══ $PASS passed, $FAIL failed ══"
exit $((FAIL > 0 ? 1 : 0))
