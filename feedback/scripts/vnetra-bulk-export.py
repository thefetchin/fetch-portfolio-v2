#!/usr/bin/env python3
"""
Build the vNetra bulk-upload CSV, and the image script to follow it.

    python3 scripts/vnetra-bulk-export.py

Pulls the whole VLite catalogue, drops the products vNetra already has, and
writes two files:

    vnetra-products-new.csv     the bulk upload
    vnetra-image-sync-new.js    a console script that adds their images,
                                once the CSV has been uploaded

Order matters: upload the CSV first. The image script finds each product by
code in vNetra's list, so a product that is not there yet is simply reported
as missing.

Your VLite password is typed into this prompt on your machine, used for one
login call, and never written anywhere.

WHICH PRODUCTS ARE "ALREADY THERE"
    Taken from --already, which reads any of:
      * a capture from scripts/vnetra-capture-products.js (JSON)
      * a previously generated vnetra-image-sync-*.js
      * a plain list of codes, one per line
    With no --already it looks for ~/Downloads/vnetra-image-sync.js, the
    229-product run that has already been done.

    Getting this wrong in the safe direction costs nothing: vNetra rejects a
    duplicate product code. Getting it wrong the other way silently omits
    products, so the script prints exactly how many it excluded and why.

A NOTE ON THE COLUMN FORMAT
    The columns below come from the products.xlsx bulk template. vNetra's own
    JS bundle carries no product-CSV template to check them against -- the
    sample files it references are for loyalty points and notifications -- so
    if the upload is rejected, the header row here is the thing to correct.
    COLUMNS is the single place to change it.
"""

import argparse
import csv
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The existing exporter already works out GST from real VLite data -- the
# amount fields are zero for most products and the rate has to come from the
# gap between mrp and taxable price. That logic is reused rather than forked:
# two copies would drift, and this is the half that is easy to get confidently
# wrong.
_spec = importlib.util.spec_from_file_location(
    "vlite_export", HERE / "vlite-products-export.py"
)
vl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vl)

COLUMNS = [
    "Product Code", "Product Name (English)", "Brand", "Category",
    "Selling Price", "Stock Qty", "HSN Code", "Product Description",
    "CGST (%)", "SGST (%)", "CESS (%)", "IGST (%)",
]

IMAGE_BASE = "https://elite.vendoliteindia.com/api/resource/images/"
# Alphanumeric brand segment, not alphabetic: "7 Up" gives AT17UP0022857.
CODE_RE = re.compile(r"^AT1[A-Z0-9]{3}\d{7}$")
DEFAULT_STOCK_QTY = 0


def read_existing_codes(path: Path):
    """Codes already in vNetra, from whichever of the three shapes `path` is."""
    if not path or not path.exists():
        return set(), f"no file at {path}" if path else "no file given"

    text = path.read_text(errors="replace")

    # A capture from vnetra-capture-products.js.
    if path.suffix == ".json":
        try:
            data = json.loads(text)
            items = data.get("products", data) if isinstance(data, dict) else data
            codes = {
                str(p.get("code", "")).strip().upper()
                for p in items if isinstance(p, dict)
            }
            codes = {c for c in codes if CODE_RE.match(c)}
            return codes, f"{len(codes)} codes from the capture {path.name}"
        except (ValueError, AttributeError):
            pass

    # A generated image-sync script, or any text with codes in it.
    codes = {c.upper() for c in re.findall(r"AT1[A-Z0-9]{3}\d{7}", text)}
    if codes:
        return codes, f"{len(codes)} codes found in {path.name}"
    return set(), f"no product codes found in {path.name}"


def row_for(product):
    """One CSV row, plus any note worth printing afterwards."""
    taxable = product.get("taxablePriceS") or product.get("taxablePriceUT")
    mrp = product.get("mrp")

    total = vl.implied_total(mrp, taxable)
    if total is None:
        # Fall back to the amount fields where they are actually populated.
        amounts = (product.get("cgst") or 0) + (product.get("sgst") or 0) + (product.get("utgst") or 0)
        total = vl.pct(amounts, taxable)
    cgst, sgst, cess, igst, flag = vl.split_total(total)

    code = (product.get("displayProductId") or "").strip().upper()
    hsn = (product.get("hsnCode") or "").strip()

    row = {
        "Product Code": code,
        "Product Name (English)": (product.get("name") or "").strip(),
        "Brand": (product.get("sub_category.category.brand.name") or "").strip(),
        "Category": (product.get("sub_category.category.name") or "").strip(),
        # Selling price is the MRP: it is what the machine charges, and it is
        # the figure the tax split above was derived against.
        # Two decimals as a string: rupees() returns a float, so 35 lands in
        # the file as "35.0", which some importers read as a malformed price.
        "Selling Price": (lambda r: "" if r is None else f"{r:.2f}")(vl.rupees(mrp)),
        # Deliberately zero. Stock in vNetra is set by loading a machine, and
        # inventing an opening quantity here would put phantom stock on the
        # books for every product in the file.
        "Stock Qty": DEFAULT_STOCK_QTY,
        "HSN Code": hsn,
        "Product Description": (product.get("name") or "").strip(),
        "CGST (%)": cgst, "SGST (%)": sgst, "CESS (%)": cess, "IGST (%)": igst,
    }
    return row, flag, hsn


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--already", type=Path,
                    default=Path.home() / "Downloads" / "vnetra-image-sync.js",
                    help="file listing the product codes vNetra already has")
    ap.add_argument("--out-dir", type=Path, default=Path.home() / "Downloads")
    ap.add_argument("--all", action="store_true",
                    help="write every product, ignoring what vNetra already has")
    ap.add_argument("--include-inactive", action="store_true")
    args = ap.parse_args()

    existing, how = read_existing_codes(None if args.all else args.already)
    print(f"Already in vNetra: {how}" if not args.all
          else "Writing every product (--all)")

    mobile = input("VLite mobile: ").strip()
    import getpass
    password = getpass.getpass("VLite password: ")
    token = vl.login(mobile, password)
    products = vl.fetch_products(token, active_only=not args.include_inactive)
    print(f"VLite returned {len(products)} products")

    rows, image_map = [], {}
    skipped_existing, no_code, odd_tax, no_hsn, no_image = [], [], [], [], []

    for p in products:
        code = (p.get("displayProductId") or "").strip().upper()
        if not CODE_RE.match(code):
            no_code.append(p.get("name") or f"id {p.get('id')}")
            continue
        if code in existing:
            skipped_existing.append(code)
            continue

        row, flag, hsn = row_for(p)
        rows.append(row)
        if flag:
            odd_tax.append(f"{code}  {row['Product Name (English)']}: {flag}")
        if not hsn:
            no_hsn.append(f"{code}  {row['Product Name (English)']}")

        image = (p.get("image") or "").strip()
        if image:
            image_map[code] = image
        else:
            no_image.append(f"{code}  {row['Product Name (English)']}")

    if not rows:
        print("\nNothing to upload -- vNetra already has every product VLite knows about.")
        return 0

    args.out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = args.out_dir / "vnetra-products-new.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    js_path = args.out_dir / "vnetra-image-sync-new.js"
    template = (HERE / "vnetra-image-sync.template.js").read_text()
    js_path.write_text(
        template
        .replace("__MAP__", json.dumps(image_map, indent=2, sort_keys=True))
        .replace("__IMAGE_BASE__", IMAGE_BASE)
        .replace("__GENERATED_AT__", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
        .replace("__COUNT__", str(len(image_map)))
    )

    print(f"\n  {csv_path}   {len(rows)} products")
    print(f"  {js_path}   {len(image_map)} with images")
    print(f"\nSkipped {len(skipped_existing)} already in vNetra.")

    def report(title, items, limit=12):
        if not items:
            return
        print(f"\n{title} ({len(items)}):")
        for line in items[:limit]:
            print(f"   {line}")
        if len(items) > limit:
            print(f"   ... and {len(items) - limit} more")

    report("No product code, so not written", no_code)
    report("No image in VLite, so not in the image script", no_image)
    report("No HSN code", no_hsn)
    report("Tax rate worth checking before uploading", odd_tax)

    print("\nUpload the CSV first, then run the image script in the vNetra console.")
    print("The image script finds products by code, so it needs them to exist there.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
