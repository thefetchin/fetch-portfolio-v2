# Brand logo assets

Drop logo files for the brands stocked in our machines into this folder.
The `BrandsMarquee` component picks them up automatically — no code change
needed when you add a new file.

## Filename convention

Use the `slug` defined in `src/components/BrandsMarquee.jsx`. The component
tries each extension in order (`svg` → `png` → `webp`); the first one that
exists is rendered.

| Brand                | Filename (any of)                                                            |
| -------------------- | ---------------------------------------------------------------------------- |
| Lay's                | `lays.svg` / `lays.png` / `lays.webp`                                        |
| Coca-Cola            | `coca-cola.svg` / `coca-cola.png` / `coca-cola.webp`                         |
| Paper Boat           | `paper-boat.svg` / `paper-boat.png` / `paper-boat.webp`                      |
| Mogu Mogu            | `mogu-mogu.svg` / `mogu-mogu.png` / `mogu-mogu.webp`                         |
| Pringles             | `pringles.svg` / `pringles.png` / `pringles.webp`                            |
| SuperYou             | `superyou.svg` / `superyou.png` / `superyou.webp`                            |
| Sweet Karam Coffee   | `sweet-karam-coffee.svg` / `…png` / `…webp`                                  |
| Pepsi                | `pepsi.svg` / `pepsi.png` / `pepsi.webp`                                     |
| Cadbury              | `cadbury.svg` / `cadbury.png` / `cadbury.webp`                               |
| KitKat               | `kitkat.svg` / `kitkat.png` / `kitkat.webp`                                  |
| Oreo                 | `oreo.svg` / `oreo.png` / `oreo.webp`                                        |
| Snickers             | `snickers.svg` / `snickers.png` / `snickers.webp`                            |
| Red Bull             | `red-bull.svg` / `red-bull.png` / `red-bull.webp`                            |
| Bisleri              | `bisleri.svg` / `bisleri.png` / `bisleri.webp`                               |
| Sprite               | `sprite.svg` / `sprite.png` / `sprite.webp`                                  |
| Haldiram's           | `haldirams.svg` / `haldirams.png` / `haldirams.webp`                         |

If the file isn't present, the marquee renders a brand-coloured text chip
as a fallback — so the banner never breaks if something is missing.

## Recommendations

- **SVG is best** (vector, scales to any size, smallest footprint).
- Aim for a logo height of ~36px in the design; anything taller is fine,
  CSS will cap it. Width is capped at 140px.
- Logos render in greyscale by default and pop to full colour on hover —
  this keeps the whole banner visually consistent regardless of how many
  files have arrived.

## Sourcing

These logos are trademarks of their respective owners. Use files you have
the right to display — official brand kits, signed-off press assets, or
the same artwork you display physically on your machines. Don't grab logos
from random search results without checking the source's licence.
