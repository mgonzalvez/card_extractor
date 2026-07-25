# Martin's Card Extractor — Project Status

Last updated: 2026-07-25

## Product Direction

The project is intentionally grid-first. Users define one accurate reference
grid and reuse it across a PDF instead of relying on whole-page card
auto-detection.

The primary goal is predictable extraction for PnP users while keeping PDF
content and image processing in the browser.

## Current Implementation

### Application and deployment

- Static HTML, CSS, and JavaScript; no backend, package manager, or build step.
- PDF.js `4.10.38` and JSZip `3.10.1` are pinned to jsDelivr URLs.
- GitHub Pages deployment uses the custom domain
  `https://extractor.gonzhome.us`.
- Cloudflare Web Analytics is enabled.
- The interface uses the same sticky top frame, system typography, blue-violet
  tokens, translucent surfaces, responsive light/dark themes, icon theme
  control, and Related Sites dropdown as BoardSplitter and Card Formatter.
- Redundant external-site button rows were removed from the hero and footer;
  cross-site navigation now lives in the single dropdown.

### Input and grid workflow

- Separate entry points for traditional duplex and gutterfold PDFs.
- One PDF may be loaded per browser session.
- PDF pages are modeled up front and rendered lazily at `3.5x`.
- Duplex defaults to `3x3`; gutterfold defaults to `4x2`.
- Users draw one reference bounds box, drag divider lines, and classify cells
  as included cards or excluded gutters.
- Grid bounds and divider positions are normalized so the same profile can be
  applied to every page.
- Duplex page roles are editable per page.
- Gutterfold mode detects thin white gaps around initial dividers and assigns
  front/back labels from the selected front column.
- Editor zoom supports `1x`, `2x`, and `4x`.

### Preview and export

- Separate sample previews and 90° rotation controls for fronts and backs.
- Lossless PNG output in `fronts/` and `backs/` ZIP folders.
- Native-size output and six 300-DPI presets: poker, square, bridge, euro, mini,
  and tarot.
- Preset dimensions can be displayed in inches or millimeters.
- Normal export hashes transformed back images and omits duplicates.
- The optional identical-back mode chooses one back image and exports it once.
- ZIP creation reports progress and exposes a ready-state download button.

### Compatibility and image fidelity

- `Promise.withResolvers` polyfill supports browsers missing that API.
- PDF render canvases preserve alpha.
- Native output avoids resampling.
- Preset output uses high-quality canvas smoothing at 300 DPI.

## Milestone History

- **2026-02:** Product direction changed to a manual, grid-first workflow.
- **2026-04:** Custom-domain deployment and related-tool navigation were added.
- **2026-05:** Browser compatibility, additional size presets, unit labels, and
  higher-fidelity rendering/export were completed.
- **2026-07:** Project documentation was reconciled with the current
  implementation, and the UI was aligned with BoardSplitter and Card Formatter.

## Current Constraints

- A single grid profile must fit every page in the PDF.
- Gutterfold detection is heuristic and may require manual gutter marking.
- A second PDF cannot be loaded without refreshing the page.
- Applying a grid causes every page to be retained as a high-resolution canvas,
  which can use substantial memory on large documents.
- Standard-size exports use fixed 300-DPI dimensions; the unit toggle only
  changes display labels.
- Runtime libraries and analytics are remote resources, so the deployed app is
  not fully offline.
- There are no automated tests, lint scripts, or build-time checks.

## Maintenance Notes

- `gridSlicer.colTypes`, `rowTypes`, and `bandHits` remain in state but do not
  drive the current cell-based gutter model.
- `normalizeBandTypes()`, `toggleBandType()`, and
  `insertGridLineAtPoint()` are not connected to current UI events.
- Page-role logic still contains a `mixed` branch internally, but the current
  selector exposes only fronts and backs.
- Image quality and grid behavior should be validated manually with `samples/`
  and `sample output/` before releases.

## Follow-up Priorities

### P1 — reliability

- Add repeatable acceptance coverage for grid normalization, duplex role
  assignment, gutterfold classification, rotations, preset dimensions, and
  duplicate-back export.
- Test memory and responsiveness with large PDFs and define a supported
  document-size expectation.
- Continue tuning line hit targets and drag behavior for mouse and touch.

### P2 — maintainability

- Remove or wire the unused grid helpers and legacy state fields.
- Replace repeated PDF point literals with a named conversion constant.
- Decide whether loading a new PDF should be supported without a full refresh.

### P3 — product polish

- Improve recovery and guidance when automatic gutter detection is inaccurate.
- Add concise explanations of normalized-grid and output-sizing behavior where
  users are most likely to need them.
