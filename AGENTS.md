# AGENTS.md

## Project Overview
Private, in-browser web app for extracting individual card images from printable PnP PDF layouts. Grid-first workflow: build one accurate grid on a reference page and apply it across the entire document. Client-side only (PDF.js + JSZip), no backend. Deployed to GitHub Pages.

## Files
- `index.html` — UI markup (upload panels, grid controls, canvas preview, orientation check, export ZIP, and compatibility polyfills)
- `styles.css` — Visual styling (responsive layout, light/dark themes, animated bg orbs)
- `app.js` — Core logic (1845 lines): PDF rendering via PDF.js, grid slicing, ZIP export via JSZip, ES module

## Code Architecture

### Constants
- `CARD_PRESETS` — poker (2.5×3.5"), square (2.5×2.5"), bridge (2.25×3.5"), euro (2.32×3.62"), mini (1.75×2.5"), tarot (2.75×4.75")
- `SIZE_ENTRIES` — array of {key, label} objects for dynamic dropdown population
- `WORKFLOW_DEFAULTS` — duplex (3×3), gutterfold (4×2)
- `THEME_STORAGE_KEY = "cardExtractorTheme"`
- `POINTS_PER_IN = 72` — PDF coordinate units (inherited from pdf-lib convention)

### Key State Variables
Shared in a single `state` object:
- `pdfDoc` — loaded PDF document
- `pages[]` — array of page objects with rendered canvas and card rects
- `currentPageIdx` — active preview page
- `selectedCardId` — currently selected card ID
- `canvasScale` — current canvas scale factor
- `previewZoom` — zoom level (1, 2, or 4)
- `dragState` — active drag state for grid manipulation
- `hasActiveDocument` — whether a PDF is loaded
- `downloadUrl` — download link for exported ZIP
- `lastPointerType` — "mouse" or "touch"
- `workflowType` — "duplex" or "gutterfold"
- `gutterfoldFrontColumn` — "left" or "right"
- `exportRotation` — { front: 0-360, back: 0-360 }
- `gridSlicer` — full grid editor state:
  - `active` — grid is active
  - `awaitingBounds` — waiting for user to draw bounds
  - `showSlices` — show card slice outlines
  - `refPageIdx` — reference page index
  - `boundsNorm` — normalized bounds {x, y, w, h}
  - `xNorm`/`yNorm` — normalized line positions (0-1)
  - `xLines`/`yLines` — pixel line positions
  - `activeLine` — currently dragged line
  - `colTypes`/`rowTypes` — gutter band types per column/row
  - `bandHits` — gutter band detection scores {cols, rows}
  - `cellTypes` — cell classification grid (card/gutter)

### Core Functions
- `loadPdf(file)` — main entry point: reads file to ArrayBuffer, creates pdfDoc, instantiates pages, UI unlock
- `onPdfSelected(workflowType)` — file input handler, triggers loadPdf
- `applyWorkflowDefaults()` — sets rows/cols based on duplex or gutterfold
- `setWorkflowType(type)` — switches duplex/gutterfold, re-applies grid
- `initGridFromBounds(bounds)` — creates normalized grid from user-drawn box + row/col inputs
- `denormalizeGridForPage(pageIdx)` — converts normalized grid → pixel coords for a specific page
- `getRefGridBoundsPx()` — converts normalized bounds → pixel coords for reference page
- `rebuildGridStructureFromControls()` — rebuilds grid from rows/cols inputs
- `createLines(start, cell, gutter, count)` — generates line positions
- `createGridLinesWithinBounds(bounds, inputs)` — creates x/y line arrays within bounds
- `applyGridToPage(pageIdx, xLines, yLines, updateNorm)` — slices one page into card rects using grid lines
- `applyGridToAllPages()` — clones reference grid across all pages, produces card rects for each
- `exportZip()` — builds ZIP with `fronts/` and `backs/` folders, handles single-back dedup, progress UI
- `renderPreviewCanvas(targetCanvas, sample, label)` — draws front/back sample in orientation check panel
- `cropCardToCanvas(pageCanvas, card, bleedPx)` — crops a card region to canvas (uses `alpha: true` for transparent PDF elements)
- `rotateCanvasByDegrees(canvas, degrees)` — rotates canvas content
- `resizeOutput(canvas, preset)` — resizes to preset dimensions (poker/square/bridge/euro/mini/tarot) using high-quality smoothing
- `formatSizeLabel(size, useMetric)` — formats card dimensions as imperial (e.g., `2.50" × 3.50"`) or metric (e.g., `63.5 × 88.9 mm`)
- `populateSizePresetOptions()` — dynamically populates the size preset dropdown with formatted labels
- `simpleHashCanvas(canvas)` — generates hash for back image deduplication
- `updateActionStates()` — enables/disables Apply Grid and Export buttons based on grid readiness
- `updateGridReadout()` — updates card count display
- `getCardCount()` — returns total card count across all pages
- `setBusy(on, label)` — shows/hides busy overlay with label
- `setZipProgress(progress, label, active)` — updates export progress bar
- `setEngineStatus(text, good)` — sets status bar text and color

### Gutterfold-Specific Features
- `detectVerticalGutterBand(img, dividerX, top, bottom, halfWidth)` — scans vertical band for white gap
- `detectHorizontalGutterBand(img, dividerY, left, right, halfHeight)` — scans horizontal band for white gap
- `applyGutterfoldAutoBands(page, bounds, lines)` — marks detected gutter bands; user can click missed bands to mark manually via `hitTestBandToggle()`
- `resolveGutterfoldColumnRoles(cellTypes, cols)` — determines which columns are front vs back based on `state.gutterfoldFrontColumn`

### Event Flow
1. Upload `onPdfSelected(workflowType)` → `loadPdf(file)` → `state.pages[]` → `hydratePageOptions()`
2. Draw grid bounds → `initGridFromBounds(bounds)` → `gridSlicer.active = true`
3. Drag grid lines → `pointermove` updates `gridSlicer.xNorm/yNorm` → `drawCurrentPage()` redraws overlay
4. Click regions → `hitTestBandToggle(mx, my)` → toggle cellTypes (card/gutter)
5. Apply grid → `applyGridToAllPages()` → card rects on every page
6. Orientation check → `renderPreviewCanvas()` + 90° rotation controls for front/back
7. Export → `exportZip()` → PNG crop (`cropCardToCanvas`) / rotate (`rotateCanvasByDegrees`) / resize (`resizeOutput`) → JSZip blob → download link

### Image Fidelity
- PDF pages rendered at 3.5× scale (~252 DPI) for high-resolution card extraction
- Canvas context uses `alpha: true` to preserve transparent PDF elements
- PNG export via `toBlob("image/png")` is always lossless (no quality parameter)
- `resizeOutput` uses `imageSmoothingQuality = "high"` for preset sizes; "native" skips resize entirely for perfect fidelity

### UI Update Chain
`bindEvents()` wires all controls. Structure controls (rows/cols) trigger `rebuildGridStructureFromControls()` → `refreshGridPreview({ rebuildStructure: true })`. `updateActionStates()` disables/enables Apply Grid and Export buttons based on grid readiness. `updateGridReadout()` updates card count display. `updateZoomUi()` highlights active zoom button.

## Coding Conventions
- ES module (`<script type="module">`); imports PDF.js and JSZip from CDN
- Includes polyfills (e.g., `Promise.withResolvers`) for compatibility with modern web APIs on older browsers
- Single `state` object for all app state
- Single `els` object for all DOM element references (40 elements, includes `unitToggle` and `unitLabel`)
- `ctx` — shared 2D canvas context from `els.pageCanvas`
- `makeCard(rect, label, source)` creates card objects with id/x/y/w/h/label/rotation/source
- `pageRoleByIndex(index, total, workflowType)` auto-assigns front/back/role for duplex workflow
- Pointer events (pointerdown/move/up/cancel) for grid line dragging and bounds drawing
- Theme toggle saves to localStorage, resolves on init
- CSS classes use `is-disabled` patterns on buttons
- All async functions use `async/await` pattern
- Helper functions prefixed with `get`, `create`, `detect`, `apply`, `update`, `set`

## Key Patterns
- Grid lines stored in normalized (0-1) coords → denormalized to pixels per page for accurate slicing
- `bandHits` tracks overlap between grid lines and gutter bands for auto-detection scoring
- `simpleHashCanvas()` deduplicates identical back images during export
- One grid profile for the entire document (duplex v1 assumption: front and back pages share the same profile)
- Export collapses identical backs to one file when "All card backs are identical" is checked
- Grid bounds and lines are locked to reference page; applied to all pages via normalized coordinate scaling
