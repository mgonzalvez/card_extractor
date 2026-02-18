# Martin's Card Extractor

Private, in-browser web app for extracting individual card images from printable PnP PDF layouts.

## v1 Focus

- Easy grid-based slicing for non-power users
- Consistent results across all pages from one reference setup
- Client-side processing only (no file uploads to a server)
- PNG export packaged as ZIP with `fronts/` and `backs/`

## Supported v1 Workflows

- Traditional duplex PnP grid PDFs (fronts and backs on separate pages)
- Gutterfold PDFs with automatic thin-gutter detection on page 1 and click-to-remove gutter adjustments

## Current Features

- Upload PDF files (vector or scanned/flattened) using one of two start boxes:
  - Traditional Grid Duplex (`3x3` default)
  - Gutterfold (`4x2` default)
- Step 1 upload locks after a file is loaded (prevents accidental second upload in the same session)
- Workflow-specific controls:
  - Duplex: page role selector and grid row/column **lines**
  - Gutterfold: front-column selector (`left`/`right`) and grid row/column **regions**
- Draw one grid bounds box directly on the preview canvas
- Drag grid divider lines with large handles for fine alignment
- Gutterfold thin white spacer bands auto-detect as gutters on reference page; click missed bands to mark gutter
- Apply one reference grid profile to all pages
- Start-over grid action to quickly redraw bounds and rebuild the grid
- Card Preview/Orientation Check step with separate 90° rotation controls for front and back samples
- Preview zoom controls (`1x`, `2x`, `4x`) with in-panel pan/scroll
- Output sizing options:
  - Native
  - Poker (2.5 x 3.5 in)
  - Tarot (2.75 x 4.75 in)
  - Mini (1.75 x 2.5 in)
- Optional single-back export: "All card backs are identical"
- ZIP build progress indicator and ready-state download button
- Theme toggle (light/dark) with saved preference

## Workflow

1. Upload one PDF using either Duplex or Gutterfold.
2. Configure workflow-specific controls (page role for duplex, front-column side for gutterfold).
3. Set grid rows/columns and draw one bounds box around the full card layout area.
4. Drag divider lines to align cuts.
5. For gutterfold, review auto-detected gutters and click any missed gutter bands.
6. Click **Apply Grid to All Pages**.
7. Use **Card Preview/Orientation Check** to rotate front/back samples if needed.
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
