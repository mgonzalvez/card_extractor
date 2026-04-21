# AGENTS.md

## Project Overview
Private, in-browser web app for extracting individual card images from printable PnP PDF layouts. Grid-first workflow: build one accurate grid on a reference page and apply it across the entire document. Client-side only (PDF.js + JSZip), no backend. Deployed to GitHub Pages.

## Files
- `index.html` — UI markup (upload panels, grid controls, canvas preview, orientation check, export ZIP)
- `styles.css` — Visual styling (responsive layout, light/dark themes, animated bg orbs)
- `app.js` — Core logic (1793 lines): PDF rendering via PDF.js, grid slicing, ZIP export via JSZip, ES module

## Code Architecture

### Constants
- `CARD_PRESETS` — poker (2.5×3.5"), tarot (2.75×4.75"), mini (1.75×2.5")
- `WORKFLOW_DEFAULTS` — duplex (3×3), gutterfold (4×2)
- `THEME_STORAGE_KEY = "cardExtractorTheme"`
- `POINTS_PER_IN = 72` — PDF coordinate units (inherited from pdf-lib convention)

### Key State Variables
Shared in a single `state` object:
- `pdfDoc` — loaded PDF document
- `pages[]` — array of page objects with rendered canvas and card rects
- `currentPageIdx` — active preview page
- `workflowType` — "duplex" or "gutterfold"
- `gutterfoldFrontColumn` — "left" or "right"
- `exportRotation` — { front: 0-360, back: 0-360 }
- `gridSlicer` — full grid editor state: active/bounds/xNorm/yNorm/linePositions/bandTypes/cellTypes

### Core Functions
- `loadPdf()` — main entry point: reads file to ArrayBuffer, creates pdfDoc, instantiates pages, UI unlock
- `applyWorkflowDefaults()` — sets rows/cols based on duplex or gutterfold
- `initGridFromBounds(bounds)` — creates normalized grid from user-drawn box + row/col inputs
- `denormalizeGridForPage(pageIdx)` — converts normalized grid → pixel coords for a specific page
- `applyGridToPage(pageIdx, xLines, yLines)` — slices one page into card rects using grid lines
- `applyGridToAllPages()` — clones reference grid across all pages, produces card rects for each
- `exportZip()` — builds ZIP with `fronts/` and `backs/` folders, handles single-back dedup, progress UI
- `renderPreviewCanvas()` — draws front/back sample in orientation check panel
- `cropCardToCanvas()`, `rotateCanvasByDegrees()`, `resizeOutput()` — card image processing

### Gutterfold-Specific Features
- `detectVerticalGutterBand()` / `detectHorizontalGutterBand()` — auto-detects thin white bands between columns/rows
- `applyGutterfoldAutoBands()` — marks detected gutter bands; user can click missed bands to mark manually
- `resolveGutterfoldColumnRoles()` — determines which columns are front vs back based on selected column

### Event Flow
1. Upload `onPdfSelected()` → `loadPdf()` → `state.pages[]` → `hydratePageOptions()`
2. Draw grid bounds → `initGridFromBounds()` → `gridSlicer.active = true`
3. Drag grid lines → `pointermove` updates `gridSlicer.xNorm/yNorm` → `drawCurrentPage()` redraws overlay
4. Click regions → `hitTestBandToggle()` → toggle cellTypes (card/gutter)
5. Apply grid → `applyGridToAllPages()` → card rects on every page
6. Orientation check → `renderPreviewCanvas()` + 90° rotation controls for front/back
7. Export → `exportZip()` → PNG crop/rotate/resize → JSZip blob → download link

### UI Update Chain
`bindEvents()` wires all controls. Structure controls (rows/cols) trigger `refreshGridPreview({ rebuildStructure: true })`. `updateActionStates()` disables/enables Apply Grid and Export buttons based on grid readiness.

## Coding Conventions
- ES module (`<script type="module">`); imports PDF.js and JSZip from CDN
- Single `state` object for all app state
- Single `els` object for all DOM element references
- `makeCard()` creates card objects with id/x/y/w/h/label/rotation/source
- `pageRoleByIndex()` auto-assigns front/back/role for duplex workflow
- Pointer events (pointerdown/move/up/cancel) for grid line dragging and bounds drawing
- Theme toggle saves to localStorage, resolves on init
- css classes use `is-disabled` patterns on buttons

## Key Patterns
- Grid lines stored in normalized (0-1) coords → denormalized to pixels per page for accurate slicing
- `bandHits` tracks overlap between grid lines and gutter bands for auto-detection scoring
- `simpleHashCanvas()` deduplicates identical back images during export
- One grid profile for the entire document (duplex v1 assumption: front and back pages share the same profile)
- Export collapses identical backs to one file when "All card backs are identical" is checked
- Grid bounds and lines are locked to reference page; applied to all pages via normalized coordinate scaling
