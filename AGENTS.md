# AGENTS.md

## Project Overview

Martin's Card Extractor is a private, in-browser web app for extracting
individual card images from printable PnP PDF layouts. Its primary workflow is
grid-first: build one accurate grid on a reference page, store it in normalized
coordinates, and apply it across the document.

The app is static and client-side only. It uses PDF.js and JSZip from a CDN, has
no build step or application backend, and is deployed through GitHub Pages at
`https://extractor.gonzhome.us`.

## Repository Files

- `index.html` — UI markup, pre-render theme bootstrap, sticky application
  header, Related Sites dropdown, `Promise.withResolvers` compatibility
  polyfill, and Cloudflare Web Analytics tag.
- `styles.css` — BoardSplitter/Formatter-aligned design tokens, responsive
  application styling, light/dark themes, and editor overlays.
- `app.js` — ES module containing all PDF rendering, state, grid editing,
  gutter detection, preview, and ZIP export logic.
- `favicon.svg` — site icon.
- `CNAME` — GitHub Pages custom domain.
- `README.md` — user-facing feature, usage, privacy, local-run, and deployment
  documentation.
- `PROGRESS.md` — current implementation status, constraints, and follow-up
  work.
- `samples/` and `sample output/` — manual acceptance-test inputs and reference
  output.

## Runtime Dependencies

Dependencies are imported directly in `app.js`; there is no `package.json`.

- PDF.js `4.10.38`
- JSZip `3.10.1`

The interface uses the same local system/SF-style font stack as BoardSplitter
and Card Formatter, so no webfont request is required.

Serve the repository over HTTP for local development:

```bash
python3 -m http.server 8080
```

## Constants

- `CARD_PRESETS` — poker, square, bridge, euro, mini, and tarot dimensions in
  inches.
- `SIZE_ENTRIES` — labels and keys used to populate the size selector.
- `WORKFLOW_DEFAULTS` — duplex (`3x3`) and gutterfold (`4x2`) defaults.
- `THEME_STORAGE_KEY = "cardExtractorTheme"`.

PDF point conversion currently uses the literal `72` where required; there is
no shared `POINTS_PER_IN` constant.

## Application State

All mutable application state lives in the single `state` object:

- `pdfDoc` — loaded PDF.js document.
- `pages[]` — page models containing PDF dimensions, a lazily rendered canvas,
  page role, and generated card rectangles.
- `currentPageIdx` — active preview page.
- `selectedCardId` — generated-card selection placeholder; applying a grid sets
  it to the first current-page card, but the current UI does not expose
  individual card selection.
- `canvasScale` — scale from the high-resolution source canvas to the displayed
  editor canvas.
- `previewZoom` — editor zoom (`1`, `2`, or `4`).
- `dragState` — active bounds or divider drag.
- `hasActiveDocument` — locks both upload inputs after one PDF is loaded.
- `downloadUrl` — object URL for the current ZIP.
- `lastPointerType` — last pointer type, used to size hit targets.
- `workflowType` — `"duplex"` or `"gutterfold"`.
- `gutterfoldFrontColumn` — `"left"` or `"right"`.
- `exportRotation` — global front/back export rotations.
- `gridSlicer`:
  - `active` / `awaitingBounds` / `showSlices` — grid lifecycle flags.
  - `refPageIdx` — page on which the grid was created.
  - `boundsNorm` — normalized reference bounds.
  - `xNorm` / `yNorm` — normalized divider positions.
  - `xLines` / `yLines` — reference-page divider positions in source pixels.
  - `activeLine` — currently dragged divider.
  - `cellTypes` — two-dimensional `"card"` / `"gutter"` classification.
  - `colTypes`, `rowTypes`, and `bandHits` — legacy placeholders that are reset
    with the grid but do not drive current gutter classification.

## Core Flow

1. The file-input closure created in `bindEvents()` calls `loadPdf(file)`.
2. `loadPdf()` creates page models, assigns initial duplex roles, and renders
   the first preview page.
3. The first canvas drag calls `initGridFromBounds(bounds)`.
4. The grid is divided evenly from the configured row/column counts. In
   gutterfold mode, `applyGutterfoldAutoBands()` expands detected thin gaps into
   gutter cells.
5. Pointer events drag divider lines or update `cellTypes` by clicking cells.
6. `applyGridToAllPages()` denormalizes the reference grid for each page and
   generates card rectangles.
7. `updateOrientationUi()` renders one front/back sample and stores global
   90-degree rotation choices.
8. `exportZip()` crops, rotates, optionally resizes, deduplicates backs, encodes
   lossless PNGs, and creates `cards.zip`.

## Important Functions

### PDF and workflow

- `loadPdf(file)` — loads the PDF, resets session state, creates page models,
  and reveals the editor/export panels.
- `renderPdfPage(pageNumber, scale)` — renders a PDF page to an alpha-enabled
  canvas; default scale is `3.5`.
- `ensurePageCanvas(pageIdx)` — lazily renders a page when it is first needed.
- `pageRoleByIndex(index, total, workflowType)` — alternates front/back roles
  only for even-page duplex documents; gutterfold and odd-page documents
  default to front.
- `applyWorkflowDefaults()` / `setWorkflowType(type)` — configure the selected
  workflow and its UI.

### Grid editing

- `beginGridBoundsDraw()` — clears existing cards and waits for new reference
  bounds.
- `initGridFromBounds(bounds)` — creates the normalized reference grid.
- `createGridLinesWithinBounds(bounds, inputs)` — creates evenly spaced lines.
- `rebuildGridStructureFromControls()` — rebuilds the existing bounds when the
  row/column controls change.
- `denormalizeGridForPage(pageIdx)` — scales normalized divider positions to a
  rendered page.
- `hitTestGridLine()` / `hitTestBandToggle()` — resolve line drags and cell
  clicks.
- `applyGridToPage()` / `applyGridToAllPages()` — generate card rectangles from
  included cells.

`insertGridLineAtPoint()`, `normalizeBandTypes()`, and `toggleBandType()` are
currently unused legacy helpers. Do not document them as user-facing features
without wiring and testing them first.

### Gutterfold

- `detectVerticalGutterBand()` / `detectHorizontalGutterBand()` — scan around
  initial dividers for low-dark-pixel bands.
- `applyGutterfoldAutoBands()` — inserts both edges of each detected gap and
  marks resulting gutter cells.
- `resolveGutterfoldColumnRoles()` — labels the first or last included card
  column as fronts, depending on `state.gutterfoldFrontColumn`; other included
  columns are backs.

### Preview and export

- `cropCardToCanvas()` — crops a source-page card rectangle.
- `rotateCanvasByDegrees()` — applies global front/back quarter-turn rotation.
- `resizeOutput()` — leaves native output unchanged or resizes a preset to 300
  DPI with high-quality smoothing.
- `renderPreviewCanvas()` — draws a fitted front/back sample.
- `simpleHashCanvas()` — creates a lightweight post-transform hash for back
  deduplication.
- `exportZip()` — writes sequential PNG filenames into `fronts/` and `backs/`,
  compresses the archive, and updates progress.

## Workflow Rules and Constraints

- One normalized grid profile is used for the entire document.
- Duplex pages must share the same layout geometry. Page roles may differ, but
  divider geometry does not.
- Gutterfold classification is based on the reference page and reused on every
  page.
- Clicking a duplex cell toggles card/gutter. In gutterfold mode, clicking a
  cell marks it as gutter.
- Applying the grid renders every page at `3.5x`, so large PDFs can consume
  substantial browser memory.
- Loading another PDF requires a page refresh.
- Standard-size output is always 300 DPI. The unit toggle changes labels, not
  export resolution.
- Duplicate backs are removed during normal export. The single-back checkbox
  instead chooses one best back candidate and emits only `001_back.png`.

## Image Fidelity

- Pages render at `3.5x` scale, approximately 252 DPI for the usual
  72-point-per-inch PDF coordinate system.
- PDF render contexts use `{ alpha: true }`.
- Native export avoids resizing.
- Preset resizing uses `imageSmoothingEnabled = true` and
  `imageSmoothingQuality = "high"`.
- PNG export uses `canvas.toBlob(..., "image/png")` without a lossy quality
  parameter.

## Coding Conventions

- Plain browser JavaScript in one ES module; no framework or bundler.
- One `state` object for mutable data and one `els` object for DOM references.
- Shared display context: `ctx = els.pageCanvas.getContext("2d")`.
- Card objects are created by `makeCard(rect, label, source)`.
- Pointer events support mouse and touch interactions.
- Asynchronous work uses `async`/`await`.
- Helper names generally begin with `get`, `create`, `detect`, `apply`,
  `update`, `set`, or `render`.
- Theme preference is saved to `localStorage`.
- Buttons use native disabled state plus CSS classes such as `in-progress` and
  `ready`.

## Shared UI Pattern

- The top frame follows BoardSplitter and Card Formatter: a sticky translucent
  header, gradient brand mark, compact product name/subtitle, Related Sites
  dropdown, and icon theme switch.
- Theme state is applied to `document.documentElement.dataset.theme` before the
  stylesheet loads to avoid a light-theme flash. `applyTheme()` keeps the root,
  body, theme-color metadata, accessible toggle label, and stored preference in
  sync.
- `#related-sites-menu` is a native `<details>` element. `bindEvents()` closes
  it on outside clicks, Escape, and destination selection.
- The Related Sites dropdown is the only cross-site navigation list. Do not
  restore duplicate top or footer button rows.
- Shared visual tokens use blue/violet accents, translucent layered surfaces,
  a subtle background grid, 26px primary panel radii, and the system font stack.
- At narrow breakpoints the subtitle and Related Sites text progressively
  collapse while the icons remain available.

## Validation

There is currently no automated test suite or package-script lint step. Before
shipping a change:

1. Serve the app over HTTP.
2. Test both duplex and gutterfold inputs from `samples/`.
3. Exercise bounds drawing, line dragging, cell exclusion, page roles,
   front-column selection, all zoom levels, both rotation controls, native and
   preset output, duplicate-back handling, and ZIP download.
4. Inspect representative PNG dimensions and compare alignment with
   `sample output/`.
5. Test both light and dark themes and at least one touch-sized viewport.
6. Open and dismiss the Related Sites menu with pointer, outside click, Escape,
   and a narrow mobile viewport.

## Registry & provenance rule (portfolio-wide)

Personal project — completely separate from Apple work.

- `.npmrc` pins `registry=https://registry.npmjs.org`. Never let Apple's internal npm mirror (`npm.apple.com`, `artifacts.apple.com/artifactory/...`) end up in `package-lock.json`; GitHub Actions can't reach it and CI fails with `ENOTFOUND`.
- Audit before pushing: `../scripts/check-registry.sh` (add `--fix` to normalize).
- No work credentials, internal hostnames, proprietary assets, or confidential material in this repo.
