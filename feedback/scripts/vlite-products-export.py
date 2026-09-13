#!/usr/bin/env python3
"""
Export the VLite product catalogue into the bulk-upload spreadsheet.

    python3 scripts/vlite-products-export.py [--template PATH] [--out PATH]

Asks for the VLite login, pages through the whole catalogue, and fills the
template's columns. Your password is typed into this prompt on your machine,
used for one login call, and never written anywhere.

Python rather than Node, unlike the other scripts here, only because openpyxl
is already on the machine and writing .xlsx from Node would mean adding a
dependency for a one-off export.

A note on the tax columns, which took some working out against real data.

VLite's product list returns cgst / sgst / utgst as amounts in paise, and in
this catalogue they are ZERO for almost every product -- so deriving the rate
from them yields a confident, wrong 0%. The rate that actually drives pricing
is recoverable from the two figures VLite does populate:

    total rate = (mrp - taxablePrice) / taxablePrice

That is used first, with the tax-amount fields as a fallback. Observed in the
live catalogue: 5%, 12% and 18% behave as expected; drinks come out at 40%,
which is the standard 28% GST + 12% cess for aerated and energy drinks; and a
block of products come out at exactly 10%, which is not a GST slab at all and
looks like 5 having been typed into both the CGST and the SGST box.

Anything that is not a recognisable rate is still written out -- a blank tax
column in a bulk upload helps nobody -- but every one is listed at the end so
it can be checked before the file is used.
"""

import argparse
import getpass
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    import openpyxl
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("openpyxl is needed:  python3 -m pip install openpyxl")

BASE = os.environ.get("VLITE_BASE_URL", "https://elite.vendoliteindia.com")
PREFIX = "/api/leanCloud"

# Full rates, and the half-rates a CGST or SGST column carries.
FULL_RATES = [0, 5, 12, 18, 28]
HALF_RATES = [0, 2.5, 6, 9, 14]

# Total rate -> (cgst%, sgst%, cess%, note). The 40% entry is the standard
# aerated / energy drink treatment and is recognised rather than rejected.
KNOWN_TOTALS = {
    0:  (0, 0, 0, None),
    5:  (2.5, 2.5, 0, None),
    12: (6, 6, 0, None),
    18: (9, 9, 0, None),
    28: (14, 14, 0, None),
    40: (14, 14, 12, None),
}


def call(endpoint, body, token=None):
    """Every VLite endpoint is a POST with a JSON body, even the reads."""
    req = urllib.request.Request(
        f"{BASE}{PREFIX}/{endpoint}",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            # Raw JWT, with NO "Bearer " prefix. This is unusual and is what
            # VLite expects.
            **({"Authorization": token} if token else {}),
        },
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        raise SystemExit(f"VLite {endpoint} failed: HTTP {e.code}\n  {detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Could not reach VLite: {e.reason}")


def login(mobile, password):
    data = call("login", {"mobile": mobile, "password": password})
    token = data.get("token")
    if not token:
        raise SystemExit(f"Sign-in failed: {data.get('code') or data}")
    who = (data.get("data") or {}).get("name") or mobile
    print(f"  signed in as {who}")
    return token


def fetch_products(token, active_only):
    """Pages to the end. A partial catalogue silently missing rows is worse
    than a slow export."""
    out, page, size = [], 0, 100
    while page < 100:
        body = {"limit": size, "page": page}
        if active_only:
            body["active"] = True
        rows = call("getProductList", body, token).get("data") or []
        out.extend(rows)
        print(f"  page {page + 1}: {len(rows)} products (running total {len(out)})")
        if len(rows) < size:
            break
        page += 1
    return out


def snap(value, allowed, tolerance=0.35):
    """Nearest real rate, or None when it is not close to any of them."""
    if value is None:
        return None
    best = min(allowed, key=lambda a: abs(a - value))
    return best if abs(best - value) <= tolerance else None


def implied_total(mrp_paise, taxable_paise):
    """Total tax rate implied by the gross and net prices.

    This is the reliable signal in practice: VLite populates mrp and
    taxablePrice for every product, while the cgst / sgst amount fields are
    frequently zero even when tax is plainly being charged.
    """
    if not mrp_paise or not taxable_paise or taxable_paise <= 0:
        return None
    return (float(mrp_paise) - float(taxable_paise)) / float(taxable_paise) * 100.0


def split_total(total):
    """Split a total rate into the template's four columns.

    Returns (cgst, sgst, cess, igst, flag). `flag` is a human sentence when the
    rate is not one India actually uses -- the row is still filled, because a
    blank tax column in a bulk upload helps nobody, but it is reported so it can
    be checked.
    """
    if total is None:
        return None, None, None, None, "no MRP or taxable price to derive a rate from"

    snapped = snap(total, list(KNOWN_TOTALS), tolerance=0.35)
    if snapped is not None:
        cg, sg, ce, _ = KNOWN_TOTALS[snapped]
        return cg, sg, ce, 0, None

    rounded = round(total, 2)
    if abs(rounded - 10) <= 0.35:
        return 5, 5, 0, 0, ("comes out at 10%, which is not a GST slab -- looks like 5 "
                            "in both the CGST and SGST boxes; 5 + 5 reproduced as-is")
    return (round(rounded / 2, 2), round(rounded / 2, 2), 0, 0,
            f"comes out at {rounded}%, which is not a recognisable rate -- "
            f"the MRP and taxable price disagree")


def pct(amount_paise, taxable_paise):
    if not taxable_paise or taxable_paise <= 0:
        return None
    try:
        return (float(amount_paise or 0) / float(taxable_paise)) * 100.0
    except (TypeError, ValueError):
        return None


def rupees(paise):
    if paise in (None, ""):
        return None
    try:
        return round(float(paise) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def fill_workbook(template, out_path, products):
    """Writes the products into the template, keeping its header row."""
    print(f"\nFilling {template.name}...")
    wb = openpyxl.load_workbook(template)
    ws = wb[wb.sheetnames[0]]

    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    # Keep the template's own header row and its formatting; only the sample
    # data below it is replaced.
    if ws.max_row > 1:
        ws.delete_rows(2, ws.max_row - 1)

    odd_tax, missing_hsn, missing_code = [], [], []

    for i, p in enumerate(products, start=2):
        taxable = p.get("taxablePriceS") or p.get("taxablePriceUT") or p.get("taxablePaise")
        mrp = p.get("mrp") if p.get("mrp") is not None else p.get("mrpPaise")

        total = implied_total(mrp, taxable)
        if total is None:
            # Fall back to the tax-amount fields, which are right when populated.
            total = pct((p.get("cgst") or 0) + (p.get("sgst") or 0) + (p.get("utgst") or 0), taxable)
        cgst, sgst, cess, igst, flag = split_total(total)

        name = p.get("name") or ""
        if flag:
            odd_tax.append((name, flag))
        # VLite's own display id is the stable human reference. customProductId
        # is the BARCODE and deliberately does not go in this column.
        code = p.get("displayProductId") or ""
        if not code:
            missing_code.append(name)
        hsn = p.get("hsnCode") or p.get("hsn") or ""
        if not hsn:
            missing_hsn.append(name)

        row = {
            "Product Code": code,
            "Product Name (English)": name,
            "Brand": p.get("sub_category.category.brand.name") or p.get("brand") or "",
            "Category": p.get("sub_category.category.name") or p.get("category") or "",
            "Selling Price": rupees(mrp),
            # Not in the product list -- VLite holds stock per machine, not per
            # product -- so this is left at 0 rather than invented.
            "Stock Qty": 0,
            "HSN Code": hsn,
            # The product list carries no description field.
            "Product Description": "",
            "CGST (%)": cgst,
            "SGST (%)": sgst,
            "CESS (%)": cess,
            "IGST (%)": igst,
        }
        for c, h in enumerate(headers, start=1):
            ws.cell(row=i, column=c, value=row.get(h))

    wb.save(out_path)

    print(f"\n  {len(products)} products written to {out_path}")

    def report(label, names):
        if names:
            shown = ", ".join(n for n in names[:5])
            more = f" and {len(names) - 5} more" if len(names) > 5 else ""
            print(f"\n  {len(names)} {label}: {shown}{more}")

    if odd_tax:
        by_reason = {}
        for nm, why in odd_tax:
            by_reason.setdefault(why, []).append(nm)
        print(f"\n  {len(odd_tax)} products have a tax rate worth checking before you upload:")
        for why, names in by_reason.items():
            shown = ", ".join(names[:4])
            more = f" and {len(names) - 4} more" if len(names) > 4 else ""
            print(f"    - {len(names)}: {why}")
            print(f"        {shown}{more}")

    report("with no HSN code", missing_hsn)
    report("with no product code", missing_code)
    print("\n  Stock Qty is 0 on every row: VLite holds stock per machine, not per product.")
    print("  Product Description is blank: the product list has no such field.\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", default=str(Path.home() / "Downloads" / "products.xlsx"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--all", action="store_true",
                    help="include inactive products too (default: active only)")
    ap.add_argument("--raw", default=None,
                    help="also dump the API response here, to check the mapping")
    ap.add_argument("--from-json", default=None,
                    help="fill from a previously saved catalogue instead of calling VLite")
    args = ap.parse_args()

    template = Path(args.template)
    if not template.exists():
        raise SystemExit(f"Template not found: {template}")
    out_path = Path(args.out) if args.out else template.with_name(
        template.stem + "-filled" + template.suffix)

    if args.from_json:
        raw = json.loads(Path(args.from_json).read_text())
        products = raw["items"] if isinstance(raw, dict) and "items" in raw else raw
        print(f"\nUsing {len(products)} products from {args.from_json}")
        fill_workbook(template, out_path, products)
        return

    mobile = os.environ.get("VLITE_MOBILE") or input("  VLite mobile number: ").strip()
    password = os.environ.get("VLITE_PASSWORD") or getpass.getpass("  VLite password: ")
    if not mobile or not password:
        raise SystemExit("Both a mobile number and a password are needed.")

    print("\nSigning in...")
    token = login(mobile, password)

    print("\nFetching the catalogue...")
    products = fetch_products(token, active_only=not args.all)
    if not products:
        raise SystemExit("VLite returned no products.")

    if args.raw:
        Path(args.raw).write_text(json.dumps(products, indent=2))
        print(f"  response written to {args.raw}")

    fill_workbook(template, out_path, products)


if __name__ == "__main__":
    main()
