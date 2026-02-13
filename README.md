# Martin's Card Extractor

Private, in-browser web app for extracting individual card images from printable PnP PDF layouts.

## v1 Focus

- Easy grid-based slicing for non-power users
- Consistent results across all pages from one reference setup
- Client-side processing only (no file uploads to a server)
- PNG export packaged as ZIP with `fronts/` and `backs/`

## Current v1 Limitation

- Accepts traditional duplex PnP card-grid PDFs (fronts and backs on separate pages)
- Gutterfold layouts are not supported yet

## Current Features

- Upload PDF files (vector or scanned/flattened)
- Page role assignment per page: `front` or `back`
- Grid rows/columns controls via dropdown (`0` to `10`, default `3x3`)
- Draw one grid bounds box directly on the preview canvas
- Drag grid divider lines with large handles for fine alignment
- Click regions to include/exclude spacing areas from export
- Apply one grid profile to all pages
- Start-over grid action to quickly redraw bounds and rebuild the grid
- Output sizing options:
  - Native
  - Poker (2.5 x 3.5 in)
  - Tarot (2.75 x 4.75 in)
  - Mini (1.75 x 2.5 in)
- Optional single-back export: "All card backs are identical"
- ZIP build progress indicator and ready-state download button

## Workflow

1. Upload a PDF.
2. Set page roles if needed.
3. Set grid rows and columns.
4. Click and drag on the preview to draw one box around the full card image area.
5. Drag divider lines to align cuts.
6. Click regions that should be excluded (gutter/bleed spacing).
7. Click **Apply Grid to All Pages**.
8. Click **Build ZIP**, then download `cards.zip`.

## Privacy

All PDF rendering, grid slicing, image extraction, and ZIP creation run in the browser. No backend storage is required.

## Run Locally

Serve over HTTP (required for modules/workers):

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

## Deploy to GitHub Pages

1. Push project files to repository root (or `docs/`).
2. Enable GitHub Pages for that branch/folder in repository settings.
3. Open the Pages URL and test using files in `samples/`.
