import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

const CARD_PRESETS = {
  poker: { widthIn: 2.5, heightIn: 3.5 },
  tarot: { widthIn: 2.75, heightIn: 4.75 },
  mini: { widthIn: 1.75, heightIn: 2.5 },
};

const WORKFLOW_DEFAULTS = {
  duplex: { rows: 3, cols: 3 },
  gutterfold: { rows: 4, cols: 2 },
};
const THEME_STORAGE_KEY = "cardExtractorTheme";

const state = {
  pdfDoc: null,
  pages: [],
  currentPageIdx: 0,
  selectedCardId: null,
  canvasScale: 1,
  dragState: null,
  hasActiveDocument: false,
  downloadUrl: null,
  workflowType: "duplex",
  gutterfoldFrontColumn: "left",
  exportRotation: { front: 0, back: 0 },
  gridSlicer: {
    active: false,
    awaitingBounds: false,
    showSlices: false,
    refPageIdx: null,
    boundsNorm: null,
    xNorm: null,
    yNorm: null,
    xLines: null,
    yLines: null,
    activeLine: null,
    colTypes: [],
    rowTypes: [],
    bandHits: { cols: [], rows: [] },
    cellTypes: [],
  },
  lastPointerType: "mouse",
};

const els = {
  engineStatus: document.querySelector("#engine-status"),
  pdfInputDuplex: document.querySelector("#pdf-input-duplex"),
  pdfInputGutterfold: document.querySelector("#pdf-input-gutterfold"),
  docMeta: document.querySelector("#doc-meta"),
  workflowPanel: document.querySelector("#workflow-panel"),
  uploadPanel: document.querySelector("#upload-panel"),
  orientationPanel: document.querySelector("#orientation-panel"),
  exportPanel: document.querySelector("#export-panel"),
  pageSelect: document.querySelector("#page-select"),
  pageRoleField: document.querySelector("#page-role-field"),
  pageRoleSelect: document.querySelector("#page-role-select"),
  gutterfoldFrontColumnField: document.querySelector("#gutterfold-front-column-field"),
  gutterfoldFrontColumnSelect: document.querySelector("#gutterfold-front-column-select"),
  sizePresetSelect: document.querySelector("#size-preset-select"),
  resetGridBtn: document.querySelector("#reset-grid-btn"),
  applyGridBtn: document.querySelector("#apply-grid-btn"),
  applyGridBtnBottom: document.querySelector("#apply-grid-btn-bottom"),
  gridRowsInput: document.querySelector("#grid-rows-input"),
  gridColsInput: document.querySelector("#grid-cols-input"),
  gridRowsLabel: document.querySelector("#grid-rows-label"),
  gridColsLabel: document.querySelector("#grid-cols-label"),
  exportBtn: document.querySelector("#export-btn"),
  exportBtnLabel: document.querySelector("#export-btn-label"),
  exportProgressFill: document.querySelector("#export-progress-fill"),
  downloadLink: document.querySelector("#download-link"),
  singleBackToggle: document.querySelector("#single-back-toggle"),
  pageCanvas: document.querySelector("#page-canvas"),
  selectionReadout: document.querySelector("#selection-readout"),
  workflowTip: document.querySelector("#workflow-tip"),
  themeToggleBtn: document.querySelector("#theme-toggle-btn"),
  frontPreviewCanvas: document.querySelector("#front-preview-canvas"),
  backPreviewCanvas: document.querySelector("#back-preview-canvas"),
  frontRotateBtn: document.querySelector("#front-rotate-btn"),
  backRotateBtn: document.querySelector("#back-rotate-btn"),
  gridReadout: document.querySelector("#grid-readout"),
  statPages: document.querySelector("#stat-pages"),
  statCards: document.querySelector("#stat-cards"),
  statFronts: document.querySelector("#stat-fronts"),
  statBacks: document.querySelector("#stat-backs"),
};

const ctx = els.pageCanvas.getContext("2d");

function setEngineStatus(text, good = false) {
  els.engineStatus.textContent = text;
  els.engineStatus.style.color = good ? "var(--ok)" : "var(--muted)";
}

function resolveInitialTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
  if (els.themeToggleBtn) {
    const label = next === "dark" ? "Light Mode" : "Dark Mode";
    els.themeToggleBtn.textContent = label;
    els.themeToggleBtn.setAttribute("aria-label", label);
  }
}

function isGutterfoldMode() {
  return state.workflowType === "gutterfold";
}

function updateWorkflowCopy() {
  if (!els.workflowTip) return;
  if (isGutterfoldMode()) {
    els.workflowTip.innerHTML =
      "Gutterfold mode: set which side contains fronts, then define row/column region counts. Thin white spacer bands are auto-detected as <strong>GUTTER</strong>; click any missed gutter band to mark it as gutter.";
    return;
  }
  els.workflowTip.innerHTML =
    "Tip: if you change rows/columns after drawing the area, click <strong>Start Over Grid</strong> and redraw so the new structure is applied.";
}

function applyWorkflowDefaults() {
  const cfg = WORKFLOW_DEFAULTS[state.workflowType] || WORKFLOW_DEFAULTS.duplex;
  if (els.gridRowsInput) els.gridRowsInput.value = String(cfg.rows);
  if (els.gridColsInput) els.gridColsInput.value = String(cfg.cols);
  if (els.gridRowsLabel) {
    els.gridRowsLabel.textContent = isGutterfoldMode() ? "Grid row regions" : "Grid row lines";
  }
  if (els.gridColsLabel) {
    els.gridColsLabel.textContent = isGutterfoldMode() ? "Grid column regions" : "Grid column lines";
  }
  updateWorkflowCopy();
  const gutterfold = isGutterfoldMode();
  if (els.pageRoleField) {
    els.pageRoleField.hidden = gutterfold;
    els.pageRoleField.style.display = gutterfold ? "none" : "";
  }
  if (els.pageRoleSelect) els.pageRoleSelect.disabled = gutterfold;
  if (els.gutterfoldFrontColumnField) {
    els.gutterfoldFrontColumnField.hidden = !gutterfold;
    els.gutterfoldFrontColumnField.style.display = gutterfold ? "" : "none";
  }
  if (els.gutterfoldFrontColumnSelect) {
    els.gutterfoldFrontColumnSelect.disabled = !gutterfold;
    els.gutterfoldFrontColumnSelect.value = state.gutterfoldFrontColumn;
  }
  if (gutterfold && state.pages.length) {
    for (const page of state.pages) {
      page.role = "front";
      for (const card of page.cards) {
        card.label = card.label === "back" ? "back" : "front";
      }
    }
    syncStats();
  }
}

function setWorkflowType(type) {
  const next = type === "gutterfold" ? "gutterfold" : "duplex";
  const changed = state.workflowType !== next;
  state.workflowType = next;
  applyWorkflowDefaults();
  if (changed && state.pages.length) {
    beginGridBoundsDraw();
    syncStats();
    drawCurrentPage();
    setEngineStatus("Workflow changed. Redraw the grid area for this format.");
  }
}

function updateUploadLockUi() {
  const locked = !!state.hasActiveDocument;
  if (els.pdfInputDuplex) els.pdfInputDuplex.disabled = locked;
  if (els.pdfInputGutterfold) els.pdfInputGutterfold.disabled = locked;
  if (els.uploadPanel) {
    els.uploadPanel.classList.toggle("panel-locked", locked);
  }
}

function setBusy(on, label = "Working…") {
  if (els.exportBtn) els.exportBtn.disabled = on;
  if (on) {
    setEngineStatus(label);
  } else {
    updateActionStates();
  }
}

function setZipProgress(progress, label = "Build ZIP", active = false) {
  const pct = Math.max(0, Math.min(1, progress));
  if (els.exportProgressFill) {
    els.exportProgressFill.style.width = Math.round(pct * 100) + "%";
  }
  if (els.exportBtnLabel) {
    els.exportBtnLabel.textContent = label;
  }
  if (active) {
    els.exportBtn.classList.add("in-progress");
  } else {
    els.exportBtn.classList.remove("in-progress");
  }
}

function getCardCount() {
  let total = 0;
  for (const page of state.pages) {
    total += page.cards.length;
  }
  return total;
}

function updateActionStates() {
  const gridReady = !!(state.gridSlicer.active && state.gridSlicer.xNorm && state.gridSlicer.yNorm);
  if (els.applyGridBtn) {
    els.applyGridBtn.disabled = !gridReady;
    els.applyGridBtn.title = gridReady ? "" : "Draw a grid area first";
  }
  if (els.applyGridBtnBottom) {
    els.applyGridBtnBottom.disabled = !gridReady;
    els.applyGridBtnBottom.title = gridReady ? "" : "Draw a grid area first";
  }
  if (els.resetGridBtn) {
    els.resetGridBtn.disabled = state.pages.length === 0;
  }
  if (els.exportBtn) {
    const hasCards = getCardCount() > 0;
    els.exportBtn.disabled = !hasCards;
    els.exportBtn.title = hasCards ? "" : "Apply grid to generate card slices first";
  }
}

function makeCard(rect, label = "front", source = "auto") {
  return {
    id: crypto.randomUUID(),
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    label,
    rotation: 0,
    source,
  };
}

async function renderPdfPage(pageNumber, scale = 2.25) {
  const page = await state.pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const rctx = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: rctx, viewport }).promise;
  return { canvas, page, viewport };
}

function pageRoleByIndex(index, total, workflowType = state.workflowType) {
  if (workflowType === "gutterfold") {
    return "front";
  }
  if (total >= 2 && total % 2 === 0) {
    return index % 2 === 0 ? "front" : "back";
  }
  return "front";
}

async function loadPdf(file) {
  const ab = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({ data: ab, useWorkerFetch: true });
  const pdfDoc = await task.promise;
  applyWorkflowDefaults();
  state.pdfDoc = pdfDoc;
  state.hasActiveDocument = true;
  updateUploadLockUi();
  state.pages = [];
  state.currentPageIdx = 0;
  state.selectedCardId = null;
  state.exportRotation.front = 0;
  state.exportRotation.back = 0;
  state.gridSlicer.active = false;
  state.gridSlicer.awaitingBounds = false;
  state.gridSlicer.showSlices = false;
  state.gridSlicer.refPageIdx = null;
  state.gridSlicer.boundsNorm = null;
  state.gridSlicer.xNorm = null;
  state.gridSlicer.yNorm = null;
  state.gridSlicer.xLines = null;
  state.gridSlicer.yLines = null;
  state.gridSlicer.activeLine = null;
  state.gridSlicer.colTypes = [];
  state.gridSlicer.rowTypes = [];
  state.gridSlicer.bandHits = { cols: [], rows: [] };
  state.gridSlicer.cellTypes = [];
  setZipProgress(0, "Build ZIP", false);
  if (state.downloadUrl) {
    URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = null;
  }
  els.downloadLink.hidden = true;
  els.downloadLink.classList.remove("ready");

  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    state.pages.push({
      number: i,
      widthPts: vp.width,
      heightPts: vp.height,
      canvas: null,
      cards: [],
      role: pageRoleByIndex(i - 1, pdfDoc.numPages, state.workflowType),
    });
  }

  els.docMeta.textContent = `${file.name} • ${pdfDoc.numPages} pages`;
  els.workflowPanel.hidden = false;
  if (els.orientationPanel) els.orientationPanel.hidden = false;
  els.exportPanel.hidden = false;
  hydratePageOptions();
  syncStats();
  await ensurePageCanvas(state.currentPageIdx);
  drawCurrentPage();
}

function hydratePageOptions() {
  els.pageSelect.innerHTML = "";
  state.pages.forEach((p, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `Page ${p.number}`;
    els.pageSelect.append(opt);
  });
  els.pageSelect.value = String(state.currentPageIdx);
  els.pageRoleSelect.value = state.pages[state.currentPageIdx]?.role ?? "front";
}

async function ensurePageCanvas(pageIdx) {
  const pageModel = state.pages[pageIdx];
  if (!pageModel.canvas) {
    const { canvas } = await renderPdfPage(pageModel.number, 2.35);
    pageModel.canvas = canvas;
    pageModel.pxPerPt = canvas.width / pageModel.widthPts;
  }
}

function updateGridReadout() {
  if (!els.gridReadout) return;
  const g = state.gridSlicer;
  if (g.awaitingBounds) {
    els.gridReadout.textContent = "Grid slicer: draw the image area box on canvas";
    return;
  }
  if (!g.active || !g.xLines || !g.yLines) {
    els.gridReadout.textContent = "Grid slicer: not initialized";
    return;
  }
  const rows = Math.max(1, g.yLines.length - 1);
  const cols = Math.max(1, g.xLines.length - 1);
  let gutterCells = 0;
  for (const row of g.cellTypes || []) {
    for (const cell of row || []) {
      if (cell === "gutter") gutterCells += 1;
    }
  }
  const ref = g.refPageIdx == null ? "-" : String(g.refPageIdx + 1);
  els.gridReadout.textContent = "Grid slicer: " + rows + "x" + cols + " (gutter cells " + gutterCells + ") on ref page " + ref;
}

function getGridInputs() {
  const rows = Number(els.gridRowsInput?.value ?? 3);
  const cols = Number(els.gridColsInput?.value ?? 3);
  return { rows, cols };
}

function createLines(start, cell, gutter, count) {
  const lines = [start];
  let cur = start;
  for (let i = 0; i < count; i += 1) {
    cur += cell;
    lines.push(cur);
    if (i < count - 1) {
      cur += gutter;
    }
  }
  return lines;
}

function createGridLinesWithinBounds(bounds, inputs) {
  const usableW = bounds.w;
  const usableH = bounds.h;
  if (usableW <= 10 || usableH <= 10 || inputs.rows < 1 || inputs.cols < 1) {
    return null;
  }

  const cellW = usableW / inputs.cols;
  const cellH = usableH / inputs.rows;
  const xLines = createLines(bounds.x, cellW, 0, inputs.cols);
  const yLines = createLines(bounds.y, cellH, 0, inputs.rows);
  return { xLines, yLines };
}

function buildImageData(canvas) {
  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(canvas, 0, 0);
  return tctx.getImageData(0, 0, tmp.width, tmp.height);
}

function pixelLuma(data, width, x, y) {
  const xx = Math.max(0, Math.min(width - 1, x));
  const i = (y * width + xx) * 4;
  return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
}

function detectVerticalGutterBand(img, dividerX, top, bottom, halfWidth) {
  const w = img.width;
  const h = img.height;
  const data = img.data;
  const y0 = Math.max(0, Math.floor(top));
  const y1 = Math.min(h - 1, Math.ceil(bottom));
  const search = Math.max(4, Math.round(halfWidth * 2));
  const cx = Math.round(dividerX);
  const xStart = Math.max(1, cx - search);
  const xEnd = Math.min(w - 2, cx + search);
  const scores = [];
  let bestX = cx;
  let best = Number.POSITIVE_INFINITY;
  for (let x = xStart; x <= xEnd; x += 1) {
    let dark = 0;
    for (let y = y0; y <= y1; y += 2) {
      if (pixelLuma(data, w, x, y) < 220) dark += 1;
    }
    scores.push({ x, dark });
    if (dark < best) {
      best = dark;
      bestX = x;
    }
  }
  const tol = Math.max(3, Math.round(((y1 - y0 + 1) / 2) * 0.08));
  let left = bestX;
  let right = bestX;
  while (left > xStart) {
    const s = scores[left - xStart - 1];
    if (!s || s.dark > best + tol || bestX - left >= halfWidth) break;
    left -= 1;
  }
  while (right < xEnd) {
    const s = scores[right - xStart + 1];
    if (!s || s.dark > best + tol || right - bestX >= halfWidth) break;
    right += 1;
  }
  const minHalf = Math.max(2, Math.round(halfWidth * 0.35));
  if (bestX - left < minHalf) left = Math.max(xStart, bestX - minHalf);
  if (right - bestX < minHalf) right = Math.min(xEnd, bestX + minHalf);
  return { start: left, end: right };
}

function detectHorizontalGutterBand(img, dividerY, left, right, halfHeight) {
  const w = img.width;
  const h = img.height;
  const data = img.data;
  const x0 = Math.max(0, Math.floor(left));
  const x1 = Math.min(w - 1, Math.ceil(right));
  const search = Math.max(4, Math.round(halfHeight * 2));
  const cy = Math.round(dividerY);
  const yStart = Math.max(1, cy - search);
  const yEnd = Math.min(h - 2, cy + search);
  const scores = [];
  let bestY = cy;
  let best = Number.POSITIVE_INFINITY;
  for (let y = yStart; y <= yEnd; y += 1) {
    let dark = 0;
    for (let x = x0; x <= x1; x += 2) {
      if (pixelLuma(data, w, x, y) < 220) dark += 1;
    }
    scores.push({ y, dark });
    if (dark < best) {
      best = dark;
      bestY = y;
    }
  }
  const tol = Math.max(3, Math.round(((x1 - x0 + 1) / 2) * 0.08));
  let top = bestY;
  let bottom = bestY;
  while (top > yStart) {
    const s = scores[top - yStart - 1];
    if (!s || s.dark > best + tol || bestY - top >= halfHeight) break;
    top -= 1;
  }
  while (bottom < yEnd) {
    const s = scores[bottom - yStart + 1];
    if (!s || s.dark > best + tol || bottom - bestY >= halfHeight) break;
    bottom += 1;
  }
  const minHalf = Math.max(2, Math.round(halfHeight * 0.35));
  if (bestY - top < minHalf) top = Math.max(yStart, bestY - minHalf);
  if (bottom - bestY < minHalf) bottom = Math.min(yEnd, bestY + minHalf);
  return { start: top, end: bottom };
}

function applyGutterfoldAutoBands(page, bounds, lines) {
  if (!isGutterfoldMode()) {
    return {
      xLines: lines.xLines,
      yLines: lines.yLines,
      cellTypes: Array.from({ length: Math.max(1, lines.yLines.length - 1) }, () =>
        Array.from({ length: Math.max(1, lines.xLines.length - 1) }, () => "card"),
      ),
    };
  }
  const img = buildImageData(page.canvas);
  const cols = Math.max(1, lines.xLines.length - 1);
  const rows = Math.max(1, lines.yLines.length - 1);
  const cellW = bounds.w / cols;
  const cellH = bounds.h / rows;
  const xHalf = Math.max(3, Math.round(cellW * 0.06));
  const yHalf = Math.max(3, Math.round(cellH * 0.06));

  const xBands = [];
  for (let i = 1; i < lines.xLines.length - 1; i += 1) {
    xBands.push(detectVerticalGutterBand(img, lines.xLines[i], bounds.y, bounds.y + bounds.h, xHalf));
  }
  const yBands = [];
  for (let i = 1; i < lines.yLines.length - 1; i += 1) {
    yBands.push(detectHorizontalGutterBand(img, lines.yLines[i], bounds.x, bounds.x + bounds.w, yHalf));
  }

  const xLines = [lines.xLines[0]];
  for (let i = 0; i < xBands.length; i += 1) {
    const band = xBands[i];
    const prev = xLines[xLines.length - 1];
    xLines.push(Math.max(prev + 2, band.start));
    xLines.push(Math.max(prev + 4, band.end));
  }
  xLines.push(lines.xLines[lines.xLines.length - 1]);

  const yLines = [lines.yLines[0]];
  for (let i = 0; i < yBands.length; i += 1) {
    const band = yBands[i];
    const prev = yLines[yLines.length - 1];
    yLines.push(Math.max(prev + 2, band.start));
    yLines.push(Math.max(prev + 4, band.end));
  }
  yLines.push(lines.yLines[lines.yLines.length - 1]);

  const xBandTypes = [];
  for (let i = 0; i < xLines.length - 1; i += 1) {
    const center = (xLines[i] + xLines[i + 1]) / 2;
    const isGutter = xBands.some((b) => center >= b.start && center <= b.end);
    xBandTypes.push(isGutter ? "gutter" : "card");
  }
  const yBandTypes = [];
  for (let i = 0; i < yLines.length - 1; i += 1) {
    const center = (yLines[i] + yLines[i + 1]) / 2;
    const isGutter = yBands.some((b) => center >= b.start && center <= b.end);
    yBandTypes.push(isGutter ? "gutter" : "card");
  }

  const cellTypes = Array.from({ length: yBandTypes.length }, (_, r) =>
    Array.from({ length: xBandTypes.length }, (_, c) =>
      xBandTypes[c] === "gutter" || yBandTypes[r] === "gutter" ? "gutter" : "card",
    ),
  );
  return { xLines, yLines, cellTypes };
}

function beginGridBoundsDraw() {
  clearAllCards();
  state.gridSlicer.active = false;
  state.gridSlicer.awaitingBounds = true;
  state.gridSlicer.showSlices = false;
  state.gridSlicer.refPageIdx = state.currentPageIdx;
  state.gridSlicer.boundsNorm = null;
  state.gridSlicer.xNorm = null;
  state.gridSlicer.yNorm = null;
  state.gridSlicer.xLines = null;
  state.gridSlicer.yLines = null;
  state.gridSlicer.activeLine = null;
  state.gridSlicer.colTypes = [];
  state.gridSlicer.rowTypes = [];
  state.gridSlicer.bandHits = { cols: [], rows: [] };
  state.gridSlicer.cellTypes = [];
  state.selectedCardId = null;
}

function clearAllCards() {
  for (const page of state.pages) {
    page.cards = [];
  }
  state.selectedCardId = null;
}

function initGridFromBounds(bounds) {
  const page = getPage();
  if (!page?.canvas) return false;
  const W = page.canvas.width;
  const H = page.canvas.height;
  const inputs = getGridInputs();
  const lines = createGridLinesWithinBounds(bounds, inputs);
  if (!lines) {
    setEngineStatus("Grid rows and columns must both be at least 1");
    return false;
  }
  const configured = applyGutterfoldAutoBands(page, bounds, lines);

  state.gridSlicer.active = true;
  state.gridSlicer.awaitingBounds = false;
  state.gridSlicer.showSlices = false;
  state.gridSlicer.refPageIdx = state.currentPageIdx;
  state.gridSlicer.boundsNorm = {
    x: bounds.x / W,
    y: bounds.y / H,
    w: bounds.w / W,
    h: bounds.h / H,
  };
  state.gridSlicer.xLines = configured.xLines;
  state.gridSlicer.yLines = configured.yLines;
  state.gridSlicer.activeLine = null;
  state.gridSlicer.bandHits = { cols: [], rows: [] };
  state.gridSlicer.cellTypes = configured.cellTypes;
  state.gridSlicer.xNorm = configured.xLines.map((v) => v / W);
  state.gridSlicer.yNorm = configured.yLines.map((v) => v / H);

  clearAllCards();
  updateGridReadout();
  return true;
}

function denormalizeGridForPage(pageIdx) {
  const page = state.pages[pageIdx];
  if (!page?.canvas || !state.gridSlicer.xNorm || !state.gridSlicer.yNorm) return null;
  const x = state.gridSlicer.xNorm.map((n) => n * page.canvas.width);
  const y = state.gridSlicer.yNorm.map((n) => n * page.canvas.height);
  return { x, y };
}

function getRefGridBoundsPx() {
  if (!state.gridSlicer.boundsNorm || state.gridSlicer.refPageIdx == null) return null;
  const refPage = state.pages[state.gridSlicer.refPageIdx];
  if (!refPage?.canvas) return null;
  const b = state.gridSlicer.boundsNorm;
  return {
    x: b.x * refPage.canvas.width,
    y: b.y * refPage.canvas.height,
    w: b.w * refPage.canvas.width,
    h: b.h * refPage.canvas.height,
  };
}

function rebuildGridStructureFromControls() {
  const bounds = getRefGridBoundsPx();
  if (!bounds) return false;
  const lines = createGridLinesWithinBounds(bounds, getGridInputs());
  if (!lines) {
    setEngineStatus("Grid rows and columns must both be at least 1");
    return false;
  }
  const refPage = state.pages[state.gridSlicer.refPageIdx];
  const configured = applyGutterfoldAutoBands(refPage, bounds, lines);
  state.gridSlicer.xLines = configured.xLines;
  state.gridSlicer.yLines = configured.yLines;
  state.gridSlicer.xNorm = configured.xLines.map((v) => v / refPage.canvas.width);
  state.gridSlicer.yNorm = configured.yLines.map((v) => v / refPage.canvas.height);
  state.gridSlicer.cellTypes = configured.cellTypes;
  state.gridSlicer.activeLine = null;
  return true;
}

function refreshGridPreview(options = {}) {
  const rebuildStructure = !!options.rebuildStructure;
  if (!state.gridSlicer.active || state.gridSlicer.refPageIdx == null) {
    drawCurrentPage();
    return;
  }

  if (rebuildStructure) {
    const ok = rebuildGridStructureFromControls();
    if (!ok) {
      drawCurrentPage();
      return;
    }
  }

  if (state.gridSlicer.showSlices) {
    const lines = denormalizeGridForPage(state.currentPageIdx);
    if (lines) {
      applyGridToPage(state.currentPageIdx, lines.x, lines.y, false);
      syncStats();
    }
  }

  drawCurrentPage();
}

function normalizeBandTypes() {
  const cols = Math.max(1, (state.gridSlicer.xLines?.length || 0) - 1);
  const rows = Math.max(1, (state.gridSlicer.yLines?.length || 0) - 1);
  if (!Array.isArray(state.gridSlicer.colTypes)) state.gridSlicer.colTypes = [];
  if (!Array.isArray(state.gridSlicer.rowTypes)) state.gridSlicer.rowTypes = [];
  while (state.gridSlicer.colTypes.length < cols) state.gridSlicer.colTypes.push("card");
  while (state.gridSlicer.rowTypes.length < rows) state.gridSlicer.rowTypes.push("card");
  state.gridSlicer.colTypes = state.gridSlicer.colTypes.slice(0, cols);
  state.gridSlicer.rowTypes = state.gridSlicer.rowTypes.slice(0, rows);
}

function toggleBandType(axis, index) {
  if (!axis || !index) return;
}

function hitTestBandToggle(mx, my) {
  if (!state.gridSlicer.active || state.gridSlicer.refPageIdx !== state.currentPageIdx) return null;
  const lines = denormalizeGridForPage(state.currentPageIdx);
  if (!lines || lines.x.length < 2 || lines.y.length < 2) return null;
  const px = mx / state.canvasScale;
  const py = my / state.canvasScale;
  let c = -1;
  let r = -1;
  for (let i = 0; i < lines.x.length - 1; i += 1) {
    if (px >= lines.x[i] && px <= lines.x[i + 1]) { c = i; break; }
  }
  for (let j = 0; j < lines.y.length - 1; j += 1) {
    if (py >= lines.y[j] && py <= lines.y[j + 1]) { r = j; break; }
  }
  if (c < 0 || r < 0) return null;
  return { row: r, col: c };
}

function insertGridLineAtPoint(mx, my) {
  if (!state.gridSlicer.active || state.gridSlicer.refPageIdx !== state.currentPageIdx) return false;
  const page = getPage();
  if (!page?.canvas) return false;
  const lines = denormalizeGridForPage(state.currentPageIdx);
  if (!lines || lines.x.length < 2 || lines.y.length < 2) return false;
  const px = mx / state.canvasScale;
  const py = my / state.canvasScale;
  const left = lines.x[0];
  const right = lines.x[lines.x.length - 1];
  const top = lines.y[0];
  const bottom = lines.y[lines.y.length - 1];
  if (px <= left || px >= right || py <= top || py >= bottom) return false;

  const cols = Math.max(1, lines.x.length - 1);
  const rows = Math.max(1, lines.y.length - 1);
  const seed = "card";
  if (!Array.isArray(state.gridSlicer.cellTypes) || state.gridSlicer.cellTypes.length !== rows || (state.gridSlicer.cellTypes[0]||[]).length !== cols) {
    state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => seed));
  }

  let minDx = Number.POSITIVE_INFINITY;
  for (const xv of lines.x) minDx = Math.min(minDx, Math.abs(px - xv));
  let minDy = Number.POSITIVE_INFINITY;
  for (const yv of lines.y) minDy = Math.min(minDy, Math.abs(py - yv));
  const axis = minDx > minDy ? "x" : "y";

  if (axis === "x") {
    const x = [...lines.x];
    const minGap = Math.max(8, page.canvas.width * 0.003);
    let idx = -1;
    for (let i = 0; i < x.length - 1; i += 1) {
      if (px > x[i] + minGap && px < x[i + 1] - minGap) { idx = i; break; }
    }
    if (idx < 0) return false;
    x.splice(idx + 1, 0, px);
    for (let r = 0; r < state.gridSlicer.cellTypes.length; r += 1) {
      const base = state.gridSlicer.cellTypes[r][idx] || seed;
      state.gridSlicer.cellTypes[r].splice(idx, 1, base, base);
    }
    state.gridSlicer.xLines = x;
    state.gridSlicer.xNorm = x.map((v) => v / page.canvas.width);
  } else {
    const y = [...lines.y];
    const minGap = Math.max(8, page.canvas.height * 0.003);
    let idx = -1;
    for (let i = 0; i < y.length - 1; i += 1) {
      if (py > y[i] + minGap && py < y[i + 1] - minGap) { idx = i; break; }
    }
    if (idx < 0) return false;
    y.splice(idx + 1, 0, py);
    const source = state.gridSlicer.cellTypes[idx] ? [...state.gridSlicer.cellTypes[idx]] : Array.from({ length: Math.max(1, lines.x.length - 1) }, () => seed);
    state.gridSlicer.cellTypes.splice(idx, 1, source, [...source]);
    state.gridSlicer.yLines = y;
    state.gridSlicer.yNorm = y.map((v) => v / page.canvas.height);
  }

  if (state.gridSlicer.showSlices) {
    const next = denormalizeGridForPage(state.currentPageIdx);
    if (next) applyGridToPage(state.currentPageIdx, next.x, next.y, false);
    syncStats();
  }
  drawCurrentPage();
  return true;
}


function clampAndSortLines(lines, maxV) {
  const out = [...lines].sort((a, b) => a - b);
  const minGap = Math.max(8, maxV * 0.003);
  out[0] = Math.max(0, Math.min(out[0], maxV - minGap));
  for (let i = 1; i < out.length; i += 1) {
    out[i] = Math.max(out[i], out[i - 1] + minGap);
    out[i] = Math.min(out[i], maxV - (out.length - 1 - i) * minGap);
  }
  return out;
}

function resolveGutterfoldColumnRoles(cellTypes, cols) {
  const cardCols = [];
  for (let c = 0; c < cols; c += 1) {
    let cardHits = 0;
    for (let r = 0; r < cellTypes.length; r += 1) {
      if ((cellTypes[r]?.[c] || "card") === "card") cardHits += 1;
    }
    if (cardHits > 0) cardCols.push(c);
  }
  if (!cardCols.length) return new Map();
  const frontCol = state.gutterfoldFrontColumn === "right"
    ? cardCols[cardCols.length - 1]
    : cardCols[0];
  const out = new Map();
  for (const c of cardCols) {
    out.set(c, c === frontCol ? "front" : "back");
  }
  return out;
}

function applyGridToPage(pageIdx, xLines, yLines, updateNorm = true) {
  const page = state.pages[pageIdx];
  if (!page?.canvas) return 0;

  const x = clampAndSortLines(xLines, page.canvas.width - 1);
  const y = clampAndSortLines(yLines, page.canvas.height - 1);
  const cols = Math.max(1, x.length - 1);
  const rows = Math.max(1, y.length - 1);
  const seed = "card";
  if (!Array.isArray(state.gridSlicer.cellTypes) || state.gridSlicer.cellTypes.length !== rows || (state.gridSlicer.cellTypes[0]||[]).length !== cols) {
    state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => seed));
  }
  const gutterfoldRoles = isGutterfoldMode()
    ? resolveGutterfoldColumnRoles(state.gridSlicer.cellTypes, cols)
    : null;
  const cards = [];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if ((state.gridSlicer.cellTypes[r]?.[c] || seed) !== "card") continue;
      const rect = {
        x: x[c],
        y: y[r],
        w: Math.max(8, x[c + 1] - x[c]),
        h: Math.max(8, y[r + 1] - y[r]),
      };
      const label = isGutterfoldMode()
        ? (gutterfoldRoles.get(c) || "front")
        : (page.role === "back" ? "back" : "front");
      cards.push(makeCard(rect, label, "grid"));
    }
  }

  page.cards = cards;
  if (updateNorm && pageIdx === state.gridSlicer.refPageIdx) {
    state.gridSlicer.xLines = x;
    state.gridSlicer.yLines = y;
    state.gridSlicer.xNorm = x.map((v) => v / page.canvas.width);
    state.gridSlicer.yNorm = y.map((v) => v / page.canvas.height);
  }

  return cards.length;
}

function applyGridToAllPages() {
  if (!state.gridSlicer.active || !state.gridSlicer.xNorm || !state.gridSlicer.yNorm) {
    setEngineStatus("Initialize grid first");
    return Promise.resolve({ pages: 0, cards: 0 });
  }

  return (async () => {
    let pages = 0;
    let cards = 0;
    for (let i = 0; i < state.pages.length; i += 1) {
      await ensurePageCanvas(i);
      const lines = denormalizeGridForPage(i);
      if (!lines) continue;
      cards += applyGridToPage(i, lines.x, lines.y, false);
      pages += 1;
    }
    state.gridSlicer.showSlices = true;
    const currentPage = getPage();
    if (currentPage && !currentPage.cards.find((c) => c.id === state.selectedCardId)) {
      state.selectedCardId = currentPage.cards[0]?.id ?? null;
    }
    return { pages, cards };
  })();
}

function drawGridOverlay(page) {
  const onRefPage = state.gridSlicer.refPageIdx === state.currentPageIdx;
  if (!state.gridSlicer.active && !state.gridSlicer.awaitingBounds) return;

  const s = state.canvasScale;
  ctx.save();

  if (state.gridSlicer.active) {
    const lines = denormalizeGridForPage(state.currentPageIdx);
    if (lines && lines.x.length > 1 && lines.y.length > 1) {
      const xLines = lines.x;
      const yLines = lines.y;
      const cols = Math.max(1, xLines.length - 1);
      const rows = Math.max(1, yLines.length - 1);
      const seed = "card";
      if (!Array.isArray(state.gridSlicer.cellTypes) || state.gridSlicer.cellTypes.length !== rows || (state.gridSlicer.cellTypes[0]||[]).length !== cols) {
        state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => seed));
      }
      const left = xLines[0] * s;
      const right = xLines[xLines.length - 1] * s;
      const top = yLines[0] * s;
      const bottom = yLines[yLines.length - 1] * s;
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      const hit = getHitRadii(state.lastPointerType);
      const controlR = Math.max(7, hit.pick * 0.45);
      const dragActive = state.dragState?.type === "grid-line" ? { axis: state.dragState.axis, index: state.dragState.index } : null;
      const active = dragActive || state.gridSlicer.activeLine;

      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const x1 = xLines[c] * s;
          const x2 = xLines[c + 1] * s;
          const y1 = yLines[r] * s;
          const y2 = yLines[r + 1] * s;
          const type = state.gridSlicer.cellTypes[r]?.[c] || seed;
          if (type === "card" || type === "gutter") {
            if (isGutterfoldMode() && type !== "gutter") continue;
            ctx.fillStyle = type === "gutter" ? "rgba(255,138,76,0.24)" : "rgba(35,150,215,0.14)";
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
            ctx.fillStyle = type === "gutter" ? "rgba(228,97,43,0.95)" : "rgba(24,120,184,0.96)";
            ctx.font = "700 12px Space Grotesk";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            if (!isGutterfoldMode() || type === "gutter") {
              ctx.fillText(type.toUpperCase(), (x1 + x2) / 2, (y1 + y2) / 2);
            }
          }
        }
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";


      ctx.strokeStyle = "rgba(35, 150, 215, 0.9)";
      ctx.lineWidth = 2.2;
      ctx.strokeRect(left, top, right - left, bottom - top);

      const drawControl = (cx, cy, isActive = false, scale = 1) => {
        const r = (isActive ? controlR * 1.45 : controlR) * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? "rgba(255,255,255,0.96)" : "rgba(35,150,215,0.9)";
        ctx.fill();
        ctx.lineWidth = isActive ? 2.4 : 1.5;
        ctx.strokeStyle = isActive ? "rgba(35,150,215,1)" : "rgba(255,255,255,0.85)";
        ctx.stroke();
      };

      for (let i = 0; i < xLines.length; i += 1) {
        const x = xLines[i] * s;
        const isActive = !!active && active.axis === "x" && active.index === i;
        const isEdge = i === 0 || i === xLines.length - 1;
        ctx.strokeStyle = isActive ? "rgba(19,125,193,1)" : "rgba(35,150,215,0.95)";
        ctx.lineWidth = isActive ? 3.6 : 2.2;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        if (onRefPage) {
          drawControl(x, top, isActive, isEdge ? 1.35 : 1);
          drawControl(x, midY, isActive, isEdge ? 1.4 : 1.05);
          drawControl(x, bottom, isActive, isEdge ? 1.35 : 1);
        }
      }

      for (let i = 0; i < yLines.length; i += 1) {
        const y = yLines[i] * s;
        const isActive = !!active && active.axis === "y" && active.index === i;
        ctx.strokeStyle = isActive ? "rgba(19,125,193,1)" : "rgba(35,150,215,0.95)";
        ctx.lineWidth = isActive ? 3.6 : 2.2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        if (onRefPage) {
          drawControl(left, y, isActive);
          drawControl(midX, y, isActive);
          drawControl(right, y, isActive);
        }
      }
    }
  }

  if (state.dragState?.type === "grid-bounds" && onRefPage) {
    const b = state.dragState.bounds;
    const x = b.x * s;
    const y = b.y * s;
    const w = b.w * s;
    const h = b.h * s;
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(43, 182, 115, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function hitTestGridLine(mx, my) {
  if (!state.gridSlicer.active || state.gridSlicer.refPageIdx !== state.currentPageIdx) return null;
  const lines = denormalizeGridForPage(state.currentPageIdx);
  if (!lines || !lines.x.length || !lines.y.length) return null;

  const hit = getHitRadii(state.lastPointerType);
  const baseThreshold = Math.max(hit.edge * 1.8, 22);
  const controlRadius = Math.max(hit.corner * 1.25, baseThreshold * 1.25);
  const s = state.canvasScale;

  const xLines = lines.x;
  const yLines = lines.y;
  const top = yLines[0] * s;
  const bottom = yLines[yLines.length - 1] * s;
  const left = xLines[0] * s;
  const right = xLines[xLines.length - 1] * s;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const offer = (axis, index, score) => {
    if (score < bestScore) {
      bestScore = score;
      best = { axis, index };
    }
  };

  const testPoint = (axis, index, px, py, radius, bonus = 0) => {
    const dx = mx - px;
    const dy = my - py;
    const d = Math.hypot(dx, dy);
    if (d <= radius) {
      offer(axis, index, d - bonus);
    }
  };

  for (let i = 0; i < xLines.length; i += 1) {
    const px = xLines[i] * s;
    const edgeBoost = i === 0 || i === xLines.length - 1 ? 1.35 : 1;
    const r = controlRadius * edgeBoost;
    const bonus = edgeBoost > 1 ? 5 : 0;
    testPoint("x", i, px, top, r, bonus);
    testPoint("x", i, px, midY, r * 1.08, bonus + 1);
    testPoint("x", i, px, bottom, r, bonus);
  }

  for (let i = 0; i < yLines.length; i += 1) {
    const py = yLines[i] * s;
    const edgeBoost = i === 0 || i === yLines.length - 1 ? 1.15 : 1;
    const r = controlRadius * edgeBoost;
    testPoint("y", i, left, py, r);
    testPoint("y", i, midX, py, r * 1.05);
    testPoint("y", i, right, py, r);
  }

  if (best) return best;

  for (let i = 0; i < xLines.length; i += 1) {
    const px = xLines[i] * s;
    const edgeLine = i === 0 || i === xLines.length - 1;
    const th = edgeLine ? baseThreshold * 2.2 : baseThreshold;
    if (my < top - th || my > bottom + th) continue;
    const d = Math.abs(mx - px);
    if (d <= th) offer("x", i, d - (edgeLine ? 4 : 0));
  }

  for (let i = 0; i < yLines.length; i += 1) {
    const py = yLines[i] * s;
    const edgeLine = i === 0 || i === yLines.length - 1;
    const th = edgeLine ? baseThreshold * 1.3 : baseThreshold;
    if (mx < left - th || mx > right + th) continue;
    const d = Math.abs(my - py);
    if (d <= th) offer("y", i, d);
  }

  return best;
}

function getPage() {
  return state.pages[state.currentPageIdx];
}

function drawCurrentPage() {
  const page = getPage();
  if (!page?.canvas) return;

  const wrap = els.pageCanvas.parentElement;
  const wrapStyles = wrap ? getComputedStyle(wrap) : null;
  const padX = wrapStyles
    ? (parseFloat(wrapStyles.paddingLeft || "0") + parseFloat(wrapStyles.paddingRight || "0"))
    : 24;
  const wrapW = wrap ? Math.max(260, wrap.clientWidth - padX) : window.innerWidth - 36;
  const viewportW = Math.max(320, window.innerWidth - 36);
  const availableW = Math.min(wrapW, viewportW);
  const fit = Math.max(0.1, availableW / page.canvas.width);
  state.canvasScale = fit;

  els.pageCanvas.width = Math.max(1, Math.round(page.canvas.width * fit));
  els.pageCanvas.height = Math.max(1, Math.round(page.canvas.height * fit));

  ctx.clearRect(0, 0, els.pageCanvas.width, els.pageCanvas.height);
  ctx.drawImage(page.canvas, 0, 0, els.pageCanvas.width, els.pageCanvas.height);

  drawGridOverlay(page);

  if (state.gridSlicer.awaitingBounds && state.gridSlicer.refPageIdx === state.currentPageIdx) {
    els.selectionReadout.textContent = "Step 2: Draw one box around the full card layout area.";
  } else if (state.gridSlicer.active && state.gridSlicer.refPageIdx === state.currentPageIdx) {
    els.selectionReadout.textContent = isGutterfoldMode()
      ? "Step 3: Drag divider lines, then click any missed gutter band to mark it as GUTTER."
      : "Step 3: Drag divider lines, then click spacing regions you want excluded.";
  } else {
    els.selectionReadout.textContent = "Step 4: Apply the grid to all pages, then build ZIP.";
  }

  updateGridReadout();
}

function syncStats() {
  let cards = 0;
  let fronts = 0;
  let backs = 0;
  for (const p of state.pages) {
    cards += p.cards.length;
    for (const c of p.cards) {
      if (c.label === "back") backs += 1;
      else fronts += 1;
    }
  }
  els.statPages.textContent = String(state.pages.length);
  els.statCards.textContent = String(cards);
  els.statFronts.textContent = String(fronts);
  els.statBacks.textContent = String(backs);
  if (els.orientationPanel) {
    els.orientationPanel.hidden = state.pages.length === 0;
  }
  updateOrientationUi();
  updateActionStates();
}

function getMousePos(ev) {
  const rect = els.pageCanvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * els.pageCanvas.width;
  const y = ((ev.clientY - rect.top) / rect.height) * els.pageCanvas.height;
  return { x, y };
}

function getCanvasUnitsPerScreenPx() {
  const rect = els.pageCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return 1;
  const sx = els.pageCanvas.width / rect.width;
  const sy = els.pageCanvas.height / rect.height;
  return (sx + sy) / 2;
}

function getHitRadii(pointerType = "mouse") {
  const touchLike = pointerType === "touch" || pointerType === "pen";
  const unit = getCanvasUnitsPerScreenPx();
  return {
    corner: Math.max(22, (touchLike ? 46 : 30) * unit),
    edge: Math.max(20, (touchLike ? 42 : 26) * unit),
    pick: Math.max(14, (touchLike ? 28 : 18) * unit),
    nearPad: Math.max(24, (touchLike ? 50 : 34) * unit),
    drawHandle: Math.max(6, (touchLike ? 10 : 7) * unit),
  };
}

function applyPageRole(role) {
  const page = getPage();
  page.role = role;
  if (role !== "mixed") {
    page.cards.forEach((c) => {
      c.label = role;
    });
  }
  syncStats();
  drawCurrentPage();
}

function simpleHashCanvas(canvas) {
  const t = document.createElement("canvas");
  t.width = 16;
  t.height = 16;
  const tctx = t.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(canvas, 0, 0, t.width, t.height);
  const data = tctx.getImageData(0, 0, t.width, t.height).data;
  let sum = 0;
  const vals = [];
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    vals.push(v);
    sum += v;
  }
  const avg = sum / vals.length;
  return vals.map((v) => (v > avg ? "1" : "0")).join("");
}

function cropCardToCanvas(pageCanvas, card, bleedPx = 0) {
  const sx = Math.max(0, Math.floor(card.x - bleedPx));
  const sy = Math.max(0, Math.floor(card.y - bleedPx));
  const sw = Math.min(pageCanvas.width - sx, Math.ceil(card.w + bleedPx * 2));
  const sh = Math.min(pageCanvas.height - sy, Math.ceil(card.h + bleedPx * 2));

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const octx = out.getContext("2d");
  octx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  if (card.rotation !== 0) {
    const rr = document.createElement("canvas");
    const rctx = rr.getContext("2d");
    const quarterTurns = (((card.rotation / 90) % 4) + 4) % 4;
    if (quarterTurns % 2 === 1) {
      rr.width = out.height;
      rr.height = out.width;
    } else {
      rr.width = out.width;
      rr.height = out.height;
    }
    rctx.translate(rr.width / 2, rr.height / 2);
    rctx.rotate((card.rotation * Math.PI) / 180);
    rctx.drawImage(out, -out.width / 2, -out.height / 2);
    return rr;
  }

  return out;
}

function resizeOutput(canvas, preset) {
  if (preset === "native") return canvas;
  const conf = CARD_PRESETS[preset];
  if (!conf) return canvas;
  const dpi = 300;
  const out = document.createElement("canvas");
  out.width = Math.round(conf.widthIn * dpi);
  out.height = Math.round(conf.heightIn * dpi);
  const rctx = out.getContext("2d");
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = "high";
  rctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function rotateCanvasByDegrees(canvas, degrees) {
  const norm = ((degrees % 360) + 360) % 360;
  if (!norm) return canvas;
  const turns = Math.round(norm / 90) % 4;
  if (!turns) return canvas;
  const out = document.createElement("canvas");
  if (turns % 2) {
    out.width = canvas.height;
    out.height = canvas.width;
  } else {
    out.width = canvas.width;
    out.height = canvas.height;
  }
  const octx = out.getContext("2d");
  octx.translate(out.width / 2, out.height / 2);
  octx.rotate((turns * Math.PI) / 2);
  octx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("PNG encode failed"));
        else resolve(blob);
      },
      "image/png",
      0.95,
    );
  });
}

function getSampleCardByLabel(label) {
  for (const page of state.pages) {
    for (const card of page.cards) {
      if (card.label === label) return { page, card };
    }
  }
  return null;
}

function renderPreviewCanvas(targetCanvas, sample, label) {
  if (!targetCanvas) return;
  const pctx = targetCanvas.getContext("2d");
  pctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  pctx.fillStyle = "#f4efe6";
  pctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  if (!sample) {
    pctx.fillStyle = "#6a5b4e";
    pctx.font = "600 13px Space Grotesk";
    pctx.textAlign = "center";
    pctx.textBaseline = "middle";
    pctx.fillText("No " + label + " sample yet", targetCanvas.width / 2, targetCanvas.height / 2);
    return;
  }
  let crop = cropCardToCanvas(sample.page.canvas, sample.card, 0);
  crop = rotateCanvasByDegrees(crop, state.exportRotation[label]);
  const pad = 8;
  const fit = Math.min(
    (targetCanvas.width - pad * 2) / Math.max(1, crop.width),
    (targetCanvas.height - pad * 2) / Math.max(1, crop.height),
  );
  const dw = Math.max(1, Math.round(crop.width * fit));
  const dh = Math.max(1, Math.round(crop.height * fit));
  const dx = Math.round((targetCanvas.width - dw) / 2);
  const dy = Math.round((targetCanvas.height - dh) / 2);
  pctx.drawImage(crop, dx, dy, dw, dh);
}

function updateOrientationUi() {
  if (els.frontRotateBtn) {
    els.frontRotateBtn.textContent = "Rotate Front 90° (" + state.exportRotation.front + "°)";
  }
  if (els.backRotateBtn) {
    els.backRotateBtn.textContent = "Rotate Back 90° (" + state.exportRotation.back + "°)";
  }
  renderPreviewCanvas(els.frontPreviewCanvas, getSampleCardByLabel("front"), "front");
  renderPreviewCanvas(els.backPreviewCanvas, getSampleCardByLabel("back"), "back");
}

function scoreBackCandidate(page, card) {
  let score = card.w * card.h;
  if (page.role === "back") score += 1500;
  return score;
}

async function exportZip() {
  setBusy(true, "Building ZIP...");
  setZipProgress(0.02, "Building ZIP 0%", true);
  els.downloadLink.classList.remove("ready");

  const zip = new JSZip();
  const frontsFolder = zip.folder("fronts");
  const backsFolder = zip.folder("backs");

  const bleedIn = 0;
  const preset = els.sizePresetSelect.value;
  const singleBackOnly = !!els.singleBackToggle?.checked;

  let frontIndex = 1;
  let backIndex = 1;
  const backHashes = new Set();
  let bestBack = null;

  const totalCards = Math.max(1, state.pages.reduce((acc, p) => acc + p.cards.length, 0));
  let processed = 0;

  for (let i = 0; i < state.pages.length; i += 1) {
    const page = state.pages[i];
    await ensurePageCanvas(i);
    const ppi = page.canvas.width / (page.widthPts / 72);
    const bleedPx = Math.round(bleedIn * ppi);

    for (const card of page.cards) {
      if (card.label === "back" && singleBackOnly) {
        const score = scoreBackCandidate(page, card);
        if (!bestBack || score > bestBack.score) {
          bestBack = { page, card: { ...card }, bleedPx, score };
        }
      } else {
        let crop = cropCardToCanvas(page.canvas, card, bleedPx);
        const globalRot = card.label === "back" ? state.exportRotation.back : state.exportRotation.front;
        crop = rotateCanvasByDegrees(crop, globalRot);
        crop = resizeOutput(crop, preset);
        const blob = await canvasToPngBlob(crop);

        if (card.label === "back") {
          const hash = simpleHashCanvas(crop);
          if (!backHashes.has(hash)) {
            backHashes.add(hash);
            backsFolder.file(String(backIndex).padStart(3, "0") + "_back.png", blob);
            backIndex += 1;
          }
        } else {
          frontsFolder.file(String(frontIndex).padStart(3, "0") + "_front.png", blob);
          frontIndex += 1;
        }
      }

      processed += 1;
      const pct = processed / totalCards;
      const progress = 0.05 + pct * 0.8;
      setZipProgress(progress, "Building ZIP " + Math.round(progress * 100) + "%", true);
    }
  }

  if (singleBackOnly && bestBack) {
    let crop = cropCardToCanvas(bestBack.page.canvas, bestBack.card, bestBack.bleedPx);
    crop = rotateCanvasByDegrees(crop, state.exportRotation.back);
    crop = resizeOutput(crop, preset);
    const blob = await canvasToPngBlob(crop);
    backsFolder.file("001_back.png", blob);
  }

  const zipBlob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 8 } },
    (meta) => {
      const zipPct = Math.max(0, Math.min(100, meta.percent ?? 0));
      const progress = 0.85 + (zipPct / 100) * 0.15;
      setZipProgress(progress, "Building ZIP " + Math.round(progress * 100) + "%", true);
    },
  );

  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state.downloadUrl = URL.createObjectURL(zipBlob);
  els.downloadLink.href = state.downloadUrl;
  els.downloadLink.hidden = false;
  els.downloadLink.classList.add("ready");
  setZipProgress(1, "ZIP Ready", false);
  setEngineStatus("ZIP ready", true);
  setBusy(false);
}
function bindEvents() {
  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener("click", () => {
      const cur = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
      applyTheme(cur === "dark" ? "light" : "dark");
    });
  }
  const onPdfSelected = (workflowType) => async (ev) => {
    if (state.hasActiveDocument) {
      setEngineStatus("A PDF is already loaded for this session. Refresh to start a new file.");
      return;
    }
    const file = ev.target.files?.[0];
    if (!file) return;
    setWorkflowType(workflowType);
    setBusy(true, "Loading PDF...");
    try {
      await loadPdf(file);
      setEngineStatus("Ready", true);
    } catch (err) {
      console.error(err);
      setEngineStatus("PDF load failed: " + err.message);
    } finally {
      setBusy(false);
    }
  };
  els.pdfInputDuplex.addEventListener("change", onPdfSelected("duplex"));
  els.pdfInputGutterfold.addEventListener("change", onPdfSelected("gutterfold"));

  els.pageSelect.addEventListener("change", async () => {
    state.currentPageIdx = Number(els.pageSelect.value);
    state.selectedCardId = null;
    if (!isGutterfoldMode()) {
      els.pageRoleSelect.value = getPage().role;
    }
    await ensurePageCanvas(state.currentPageIdx);
    drawCurrentPage();
  });

  els.pageRoleSelect.addEventListener("change", () => {
    if (isGutterfoldMode()) return;
    applyPageRole(els.pageRoleSelect.value);
  });
  if (els.frontRotateBtn) {
    els.frontRotateBtn.addEventListener("click", () => {
      state.exportRotation.front = (state.exportRotation.front + 90) % 360;
      updateOrientationUi();
    });
  }
  if (els.backRotateBtn) {
    els.backRotateBtn.addEventListener("click", () => {
      state.exportRotation.back = (state.exportRotation.back + 90) % 360;
      updateOrientationUi();
    });
  }
  if (els.gutterfoldFrontColumnSelect) {
    els.gutterfoldFrontColumnSelect.addEventListener("change", async () => {
      state.gutterfoldFrontColumn = els.gutterfoldFrontColumnSelect.value === "right" ? "right" : "left";
      if (!isGutterfoldMode()) return;
      if (state.gridSlicer.showSlices) {
        setBusy(true, "Updating front/back mapping...");
        try {
          await applyGridToAllPages();
          syncStats();
          drawCurrentPage();
          setEngineStatus("Front/back columns updated", true);
        } finally {
          setBusy(false);
        }
      }
    });
  }
  if (els.resetGridBtn) {
    els.resetGridBtn.addEventListener("click", () => {
      beginGridBoundsDraw();
      setEngineStatus("Draw a box around the full image area, then release pointer", true);
      updateActionStates();
      drawCurrentPage();
    });
  }

  const runApplyGridAll = async () => {
    setBusy(true, "Applying grid to all pages...");
    try {
      const result = await applyGridToAllPages();
      syncStats();
      drawCurrentPage();
      setEngineStatus("Grid applied to " + result.pages + " pages (" + result.cards + " cards)", result.cards > 0);
    } catch (err) {
      console.error(err);
      setEngineStatus("Apply grid failed: " + err.message);
    } finally {
      setBusy(false);
      updateActionStates();
    }
  };

  if (els.applyGridBtn) {
    els.applyGridBtn.addEventListener("click", runApplyGridAll);
  }
  if (els.applyGridBtnBottom) {
    els.applyGridBtnBottom.addEventListener("click", runApplyGridAll);
  }

  const structureControls = [els.gridRowsInput, els.gridColsInput];
  structureControls.forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => refreshGridPreview({ rebuildStructure: true }));
    el.addEventListener("change", () => refreshGridPreview({ rebuildStructure: true }));
  });
  if (els.exportBtn) {
    els.exportBtn.addEventListener("click", exportZip);
  }

  window.addEventListener("resize", () => {
    const page = getPage();
    if (page?.canvas) drawCurrentPage();
  });

  els.pageCanvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    state.lastPointerType = ev.pointerType || state.lastPointerType || "mouse";
    const page = getPage();
    if (!page?.canvas) return;
    const { x, y } = getMousePos(ev);
    const px = x / state.canvasScale;
    const py = y / state.canvasScale;

    if (!state.gridSlicer.active && !state.gridSlicer.awaitingBounds) {
      beginGridBoundsDraw();
      setEngineStatus("Draw a box around the full image area, then release pointer", true);
    }

    if (state.gridSlicer.awaitingBounds && state.gridSlicer.refPageIdx === state.currentPageIdx) {
      state.dragState = {
        type: "grid-bounds",
        startX: px,
        startY: py,
        bounds: { x: px, y: py, w: 1, h: 1 },
      };
      els.pageCanvas.setPointerCapture(ev.pointerId);
      drawCurrentPage();
      return;
    }

    const lineHit = hitTestGridLine(x, y);
    if (lineHit && state.gridSlicer.refPageIdx === state.currentPageIdx) {
      const lines = denormalizeGridForPage(state.currentPageIdx);
      if (!lines) return;
      state.gridSlicer.activeLine = { axis: lineHit.axis, index: lineHit.index };
      state.dragState = {
        type: "grid-line",
        axis: lineHit.axis,
        index: lineHit.index,
        startX: x,
        startY: y,
        origX: [...lines.x],
        origY: [...lines.y],
      };
      els.pageCanvas.setPointerCapture(ev.pointerId);
      return;
    }

    const bandHit = hitTestBandToggle(x, y);
    if (bandHit && state.gridSlicer.refPageIdx === state.currentPageIdx) {
      if (!state.gridSlicer.cellTypes?.[bandHit.row]) return;
      const currentType = state.gridSlicer.cellTypes?.[bandHit.row]?.[bandHit.col] || "card";
      const nextType = isGutterfoldMode() ? "gutter" : (currentType === "gutter" ? "card" : "gutter");
      state.gridSlicer.cellTypes[bandHit.row][bandHit.col] = nextType;
      if (state.gridSlicer.showSlices) {
        const lines = denormalizeGridForPage(state.currentPageIdx);
        if (lines) applyGridToPage(state.currentPageIdx, lines.x, lines.y, false);
        syncStats();
      }
      drawCurrentPage();
      return;
    }

    state.dragState = null;
    state.gridSlicer.activeLine = null;
    drawCurrentPage();
  });
  els.pageCanvas.addEventListener("pointermove", (ev) => {
    state.lastPointerType = ev.pointerType || state.lastPointerType || "mouse";
    const { x, y } = getMousePos(ev);

    if (!state.dragState) {
      if (state.gridSlicer.awaitingBounds && state.gridSlicer.refPageIdx === state.currentPageIdx) {
        els.pageCanvas.style.cursor = "crosshair";
        return;
      }
      const hoverLine = hitTestGridLine(x, y);
      if (hoverLine) {
        els.pageCanvas.style.cursor = hoverLine.axis === "x" ? "ew-resize" : "ns-resize";
        return;
      }
      els.pageCanvas.style.cursor = "default";
      return;
    }

    if (state.dragState.type === "grid-bounds") {
      const page = getPage();
      if (!page?.canvas) return;
      const px = x / state.canvasScale;
      const py = y / state.canvasScale;
      const b = state.dragState.bounds;
      b.x = Math.max(0, Math.min(state.dragState.startX, px));
      b.y = Math.max(0, Math.min(state.dragState.startY, py));
      b.w = Math.max(1, Math.min(page.canvas.width - b.x, Math.abs(px - state.dragState.startX)));
      b.h = Math.max(1, Math.min(page.canvas.height - b.y, Math.abs(py - state.dragState.startY)));
      drawCurrentPage();
      return;
    }

    if (state.dragState.type === "grid-line") {
      const page = getPage();
      if (!page?.canvas) return;
      const nx = 0;
      const ny = 0;
      const minGapX = Math.max(8, page.canvas.width * 0.003);
      const minGapY = Math.max(8, page.canvas.height * 0.003);
      let displayX = [...state.dragState.origX];
      let displayY = [...state.dragState.origY];

      if (state.dragState.axis === "x") {
        const idx = state.dragState.index;
        const proposed = x / state.canvasScale;
        const lo = idx > 0 ? displayX[idx - 1] + minGapX : 0;
        const hi = idx < displayX.length - 1 ? displayX[idx + 1] - minGapX : page.canvas.width - minGapX;
        displayX[idx] = Math.max(lo, Math.min(proposed, hi));
      } else {
        const idx = state.dragState.index;
        const proposed = y / state.canvasScale;
        const lo = idx > 0 ? displayY[idx - 1] + minGapY : 0;
        const hi = idx < displayY.length - 1 ? displayY[idx + 1] - minGapY : page.canvas.height - minGapY;
        displayY[idx] = Math.max(lo, Math.min(proposed, hi));
      }

      state.gridSlicer.xLines = displayX.map((v) => v - nx);
      state.gridSlicer.yLines = displayY.map((v) => v - ny);
      state.gridSlicer.xNorm = state.gridSlicer.xLines.map((v) => v / page.canvas.width);
      state.gridSlicer.yNorm = state.gridSlicer.yLines.map((v) => v / page.canvas.height);

      if (state.gridSlicer.showSlices) {
        applyGridToPage(state.currentPageIdx, displayX, displayY, false);
      }
      syncStats();
      drawCurrentPage();
      return;
    }

    state.dragState = null;
    drawCurrentPage();
  });

  els.pageCanvas.addEventListener("pointerup", () => {
    const page = getPage();
    if (state.dragState?.type === "grid-bounds") {
      const b = state.dragState.bounds;
      if (b.w < 20 || b.h < 20) {
        setEngineStatus("Selected area is too small. Draw a larger image-area box.");
        state.dragState = null;
        drawCurrentPage();
        return;
      }
      const ok = initGridFromBounds(b);
      if (ok) {
        setEngineStatus("Grid initialized. Drag lines to align slices, then apply to all pages.", true);
      }
      state.dragState = null;
      syncStats();
      drawCurrentPage();
      return;
    }


    state.dragState = null;
    els.pageCanvas.style.cursor = "default";
    syncStats();
    drawCurrentPage();
  });

  els.pageCanvas.addEventListener("pointercancel", () => {
    state.dragState = null;
    if (state.gridSlicer.awaitingBounds && state.gridSlicer.refPageIdx === state.currentPageIdx) {
      els.pageCanvas.style.cursor = "crosshair";
      return;
    }
    els.pageCanvas.style.cursor = "default";
  });

}
async function init() {
  try {
    applyTheme(resolveInitialTheme());
    setEngineStatus("Loading engines…");
    setWorkflowType("duplex");
    updateUploadLockUi();
    bindEvents();
    updateGridReadout();
    updateActionStates();
    setEngineStatus("Ready", true);
  } catch (err) {
    console.error(err);
    setEngineStatus("Init failed: " + (err?.message || String(err)));
  }
}

init();
