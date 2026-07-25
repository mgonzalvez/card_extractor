# Martin's Card Extractor

Martin's Card Extractor is a private, in-browser tool for turning printable
print-and-play (PnP) PDF layouts into individual card images.

Use one page to define and refine a grid, apply that normalized grid to every
page in the document, preview front/back orientation, and download the results
as a ZIP.

Live site: [extractor.gonzhome.us](https://extractor.gonzhome.us)

## Supported Workflows

- **Traditional Grid Duplex** — front and back sheets on separate pages; starts
  with a `3x3` grid.
- **Gutterfold** — foldable layouts with front and back columns on the same
  page; starts with `4x2` regions and detects thin white gutter bands around the
  initial dividers.

## Features

- PDF input for vector or scanned/flattened documents.
- Client-side PDF rendering and card extraction; the selected PDF is not
  uploaded to an application server.
- One reference grid stored in normalized coordinates and scaled across all
  pages.
- Direct canvas interaction:
  - draw the full layout bounds;
  - drag divider lines with mouse or touch;
  - toggle excluded cells in duplex mode or mark missed gutters in gutterfold
    mode.
- Duplex page-role controls. Even-page documents default to alternating front
  and back pages, and roles can be corrected per page.
- Gutterfold front-column selection (`left` or `right`) and automatic
  thin-gutter detection.
- Preview zoom at `1x`, `2x`, and `4x`, with scrolling at higher zoom levels.
- Separate front and back orientation previews with rotation in 90° steps.
- Native output or six standard card sizes rendered at 300 DPI:
  - Poker — 2.5 × 3.5 in
  - Square — 2.5 × 2.5 in
  - Bridge — 2.25 × 3.5 in
  - Euro — 2.32 × 3.62 in
  - Mini — 1.75 × 2.5 in
  - Tarot — 2.75 × 4.75 in
- Imperial/metric display toggle for preset dimensions.
- Lossless PNG export to `fronts/` and `backs/` folders inside `cards.zip`.
- Automatic duplicate-back removal, plus an option to export only one back
  when every card uses the same image.
- ZIP progress and ready-to-download states.
- BoardSplitter/Card Formatter-aligned interface with a sticky translucent
  application frame, system typography, and shared blue-violet visual tokens.
- Responsive light/dark themes with the preference stored in `localStorage`.
- A responsive **Related Sites** dropdown replaces the previous rows of
  external navigation buttons.
- Compatibility polyfill for `Promise.withResolvers` on browsers that can run
  PDF.js v4 but do not yet provide that API.

## Usage

1. Choose **Traditional Grid Duplex PDF** or **Gutterfold PDF** and select a
   PDF. The upload choices lock for the rest of the session; refresh the page
   to load a different file.
2. Choose a reference page and configure its workflow-specific controls.
3. Set the row and column counts.
4. Drag a box around the complete card layout on the preview.
5. Drag divider lines to align the cuts. Click cells that should be excluded;
   in gutterfold mode, review the automatically marked gutter cells.
6. Select **Apply Grid to All Pages**.
7. Check the front and back previews and rotate either group if needed.
8. Choose native output or a standard size. Enable the single-back option when
   appropriate.
9. Select **Build ZIP**, then **Download cards.zip**.

## Image and Export Behavior

- PDF pages are rendered at `3.5x` PDF scale (approximately 252 DPI for the
  usual 72-point-per-inch PDF coordinate system).
- The PDF render canvas preserves alpha transparency.
- Native output skips resizing.
- Standard presets resize to their physical dimensions at 300 DPI with
  high-quality canvas smoothing.
- PNG encoding is lossless.
- Back images are reduced to a small threshold hash after rotation/resizing;
  matching hashes are treated as duplicates.

## Privacy and External Resources

PDF rendering, grid slicing, image processing, and ZIP creation happen in the
browser. The selected PDF is not sent to a project backend.

The deployed page still makes normal network requests for PDF.js and JSZip from
jsDelivr and Cloudflare Web Analytics. Consequently, the app is client-side but
not fully offline.

## Run Locally

The app has no package manager, build step, or local backend. Serve the
repository over HTTP because browser modules and the PDF.js worker do not work
reliably from `file://` URLs:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Runtime dependencies are pinned in `app.js` and loaded as ES modules:

- PDF.js `4.10.38`
- JSZip `3.10.1`

An internet connection is required for PDF.js and JSZip unless those CDN
resources are replaced with local copies.

## Repository Layout

- `index.html` — application markup, pre-render theme bootstrap, shared top
  frame, Related Sites menu, compatibility polyfill, and analytics tag.
- `styles.css` — shared BoardSplitter/Formatter design tokens, responsive
  layout, editor styling, and light/dark themes.
- `app.js` — PDF loading, grid editing, gutter detection, card rendering, and
  ZIP export.
- `favicon.svg` — site icon.
- `CNAME` — GitHub Pages custom domain (`extractor.gonzhome.us`).
- `AGENTS.md` — implementation map and coding guidance for contributors.
- `PROGRESS.md` — current status, constraints, and follow-up work.
- `samples/` and `sample output/` — manual acceptance-test material.

## Deployment

The project is deployed as a static GitHub Pages site from the repository root.
The `CNAME` file maps the deployment to
[extractor.gonzhome.us](https://extractor.gonzhome.us).

After pushing a change, test both workflows with the PDFs in `samples/` and
compare the resulting images with `sample output/`.
