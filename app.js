import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

const CARD_PRESETS = {
  poker: { widthIn: 2.5, heightIn: 3.5 },
  tarot: { widthIn: 2.75, heightIn: 4.75 },
  mini: { widthIn: 1.75, heightIn: 2.5 },
};

const state = {
  pdfDoc: null,
  pages: [],
  currentPageIdx: 0,
  selectedCardId: null,
  canvasScale: 1,
  dragState: null,
  addMode: false,
  cvReady: false,
  downloadUrl: null,
  templates: {
    front: null,
    back: null,
  },
  frontCalibration: {
    anchors: { a: null, b: null, c: null },
    outliersByPage: new Map(),
    showOutliersOnly: false,
  },
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
  pdfInput: document.querySelector("#pdf-input"),
  docMeta: document.querySelector("#doc-meta"),
  workflowPanel: document.querySelector("#workflow-panel"),
  exportPanel: document.querySelector("#export-panel"),
  pageSelect: document.querySelector("#page-select"),
  pageRoleSelect: document.querySelector("#page-role-select"),
  minAreaInput: document.querySelector("#min-area-input"),
  aspectModeSelect: document.querySelector("#aspect-mode-select"),
  sizePresetSelect: document.querySelector("#size-preset-select"),
  resetGridBtn: document.querySelector("#reset-grid-btn"),
  applyGridBtn: document.querySelector("#apply-grid-btn"),
  applyGridBtnBottom: document.querySelector("#apply-grid-btn-bottom"),
  gridRowsInput: document.querySelector("#grid-rows-input"),
  gridColsInput: document.querySelector("#grid-cols-input"),
  addBoxBtn: document.querySelector("#add-box-btn"),
  deleteBoxBtn: document.querySelector("#delete-box-btn"),
  toggleLabelBtn: document.querySelector("#toggle-label-btn"),
  rotateLeftBtn: document.querySelector("#rotate-left-btn"),
  rotateRightBtn: document.querySelector("#rotate-right-btn"),
  setFrontTemplateBtn: document.querySelector("#set-front-template-btn"),
  setBackTemplateBtn: document.querySelector("#set-back-template-btn"),
  applyTemplatesBtn: document.querySelector("#apply-templates-btn"),
  setAnchorABtn: document.querySelector("#set-anchor-a-btn"),
  setAnchorBBtn: document.querySelector("#set-anchor-b-btn"),
  setAnchorCBtn: document.querySelector("#set-anchor-c-btn"),
  calibrateFrontGridBtn: document.querySelector("#calibrate-front-grid-btn"),
  toggleOutliersBtn: document.querySelector("#toggle-outliers-btn"),
  exportBtn: document.querySelector("#export-btn"),
  exportBtnLabel: document.querySelector("#export-btn-label"),
  exportProgressFill: document.querySelector("#export-progress-fill"),
  downloadLink: document.querySelector("#download-link"),
  singleBackToggle: document.querySelector("#single-back-toggle"),
  pageCanvas: document.querySelector("#page-canvas"),
  selectionReadout: document.querySelector("#selection-readout"),
  templateReadout: document.querySelector("#template-readout"),
  calibrationReadout: document.querySelector("#calibration-readout"),
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

async function waitForOpenCv(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.cv && typeof window.cv.imread === "function") {
      return true;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

function setBusy(on, label = "Working…") {
  if (els.autodetectBtn) els.autodetectBtn.disabled = on;
  if (els.exportBtn) els.exportBtn.disabled = on;
  if (els.resetPageBtn) els.resetPageBtn.disabled = on;
  if (els.applyTemplatesBtn) {
    els.applyTemplatesBtn.disabled = on;
  }
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

function pageRoleByIndex(index, total) {
  if (total >= 2 && total % 2 === 0) {
    return index % 2 === 0 ? "front" : "back";
  }
  return "front";
}

async function loadPdf(file) {
  const ab = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({ data: ab, useWorkerFetch: true });
  const pdfDoc = await task.promise;
  state.pdfDoc = pdfDoc;
  state.pages = [];
  state.currentPageIdx = 0;
  state.selectedCardId = null;
  state.templates.front = null;
  state.templates.back = null;
  state.frontCalibration.anchors = { a: null, b: null, c: null };
  state.frontCalibration.outliersByPage = new Map();
  state.frontCalibration.showOutliersOnly = false;
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
      role: pageRoleByIndex(i - 1, pdfDoc.numPages),
    });
  }

  els.docMeta.textContent = `${file.name} • ${pdfDoc.numPages} pages`;
  els.workflowPanel.hidden = false;
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

function aspectRange(mode) {
  if (mode === "poker") return [0.66, 0.74];
  if (mode === "tarot") return [0.54, 0.61];
  if (mode === "mini") return [0.66, 0.74];
  if (mode === "free") return [0.2, 1];
  return [0.48, 0.9];
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const inter = w * h;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function nmsRects(rects) {
  const sorted = [...rects].sort((a, b) => b.w * b.h - a.w * a.h);
  const out = [];
  for (const r of sorted) {
    if (out.some((q) => iou(q, r) > 0.65)) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

function detectCardsCv(canvas, minAreaPct, mode) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const bw = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const morphed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  cv.adaptiveThreshold(
    blur,
    bw,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    35,
    9,
  );
  cv.morphologyEx(bw, morphed, cv.MORPH_CLOSE, kernel);
  cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const [minAspect, maxAspect] = aspectRange(mode);
  const minArea = (minAreaPct / 100) * canvas.width * canvas.height;
  const rects = [];

  for (let i = 0; i < contours.size(); i += 1) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < minArea) {
      cnt.delete();
      continue;
    }

    const rect = cv.minAreaRect(cnt);
    const rw = Math.max(rect.size.width, rect.size.height);
    const rh = Math.min(rect.size.width, rect.size.height);
    if (rw < 25 || rh < 25) {
      cnt.delete();
      continue;
    }

    const ratio = rh / rw;
    const bbox = cv.boundingRect(cnt);
    const nearEdge =
      bbox.x <= 3 ||
      bbox.y <= 3 ||
      bbox.x + bbox.width >= canvas.width - 3 ||
      bbox.y + bbox.height >= canvas.height - 3;

    if (!nearEdge && ratio >= minAspect && ratio <= maxAspect) {
      rects.push({ x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height });
    }

    cnt.delete();
  }

  src.delete();
  gray.delete();
  blur.delete();
  bw.delete();
  morphed.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return nmsRects(rects);
}

function morphDilate(src, w, h) {
  const out = new Uint8Array(src.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      let on = 0;
      for (let yy = -1; yy <= 1 && !on; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          if (src[i + yy * w + xx]) {
            on = 1;
            break;
          }
        }
      }
      out[i] = on;
    }
  }
  return out;
}

function morphErode(src, w, h) {
  const out = new Uint8Array(src.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      let on = 1;
      for (let yy = -1; yy <= 1 && on; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          if (!src[i + yy * w + xx]) {
            on = 0;
            break;
          }
        }
      }
      out[i] = on;
    }
  }
  return out;
}

function detectCardsFallback(canvas, minAreaPct, mode) {
  const maxDim = 1400;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(40, Math.round(canvas.width * scale));
  const h = Math.max(40, Math.round(canvas.height * scale));
  const t = document.createElement("canvas");
  t.width = w;
  t.height = h;
  const tctx = t.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(canvas, 0, 0, w, h);
  const img = tctx.getImageData(0, 0, w, h);
  const data = img.data;

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  const mean = sum / (w * h);
  const threshold = Math.min(248, Math.max(205, mean - 6));

  const binary = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    binary[p] = lum < threshold ? 1 : 0;
  }

  const closed = morphErode(morphDilate(binary, w, h), w, h);
  const visited = new Uint8Array(w * h);
  const [minAspect, maxAspect] = aspectRange(mode);
  const minArea = (minAreaPct / 100) * w * h;
  const rects = [];
  const q = new Int32Array(w * h);

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x;
      if (!closed[idx] || visited[idx]) continue;

      let head = 0;
      let tail = 0;
      q[tail++] = idx;
      visited[idx] = 1;
      let count = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (head < tail) {
        const cur = q[head++];
        const cx = cur % w;
        const cy = (cur - cx) / w;
        count += 1;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        const n1 = cur - 1;
        const n2 = cur + 1;
        const n3 = cur - w;
        const n4 = cur + w;
        if (!visited[n1] && closed[n1]) {
          visited[n1] = 1;
          q[tail++] = n1;
        }
        if (!visited[n2] && closed[n2]) {
          visited[n2] = 1;
          q[tail++] = n2;
        }
        if (!visited[n3] && closed[n3]) {
          visited[n3] = 1;
          q[tail++] = n3;
        }
        if (!visited[n4] && closed[n4]) {
          visited[n4] = 1;
          q[tail++] = n4;
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const bboxArea = bw * bh;
      const ratio = Math.min(bw, bh) / Math.max(bw, bh);
      const fill = count / Math.max(1, bboxArea);
      const nearEdge = minX < 2 || minY < 2 || maxX > w - 3 || maxY > h - 3;

      if (
        !nearEdge &&
        bboxArea >= minArea &&
        bw > 16 &&
        bh > 16 &&
        ratio >= minAspect &&
        ratio <= maxAspect &&
        fill > 0.08
      ) {
        const pad = 4;
        rects.push({
          x: Math.max(0, Math.round((minX - pad) / scale)),
          y: Math.max(0, Math.round((minY - pad) / scale)),
          w: Math.min(canvas.width, Math.round((bw + pad * 2) / scale)),
          h: Math.min(canvas.height, Math.round((bh + pad * 2) / scale)),
        });
      }
    }
  }

  return nmsRects(rects);
}

function buildDarkMask(canvas, maxDim = 1400) {
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(40, Math.round(canvas.width * scale));
  const h = Math.max(40, Math.round(canvas.height * scale));
  const t = document.createElement("canvas");
  t.width = w;
  t.height = h;
  const tctx = t.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(canvas, 0, 0, w, h);
  const { data } = tctx.getImageData(0, 0, w, h);

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  const mean = sum / (w * h);
  const threshold = Math.min(248, Math.max(195, mean - 10));

  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    dark[p] = lum < threshold ? 1 : 0;
  }
  return { dark, w, h, scale };
}

function findContentBounds(dark, w, h) {
  const colCounts = new Uint32Array(w);
  const rowCounts = new Uint32Array(h);
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    for (let x = 0; x < w; x += 1) {
      const v = dark[o + x];
      colCounts[x] += v;
      rowCounts[y] += v;
    }
  }

  const colMin = Math.max(2, Math.round(h * 0.01));
  const rowMin = Math.max(2, Math.round(w * 0.01));
  let minX = 0;
  let maxX = w - 1;
  let minY = 0;
  let maxY = h - 1;
  while (minX < maxX && colCounts[minX] < colMin) minX += 1;
  while (maxX > minX && colCounts[maxX] < colMin) maxX -= 1;
  while (minY < maxY && rowCounts[minY] < rowMin) minY += 1;
  while (maxY > minY && rowCounts[maxY] < rowMin) maxY -= 1;

  if (maxX - minX < Math.round(w * 0.3) || maxY - minY < Math.round(h * 0.3)) {
    return { minX: 0, maxX: w - 1, minY: 0, maxY: h - 1, colCounts, rowCounts };
  }
  return { minX, maxX, minY, maxY, colCounts, rowCounts };
}

function findSplitCuts(profile, start, end, parts) {
  const cuts = [start];
  const span = end - start + 1;
  for (let i = 1; i < parts; i += 1) {
    const target = start + (span * i) / parts;
    const window = Math.max(8, Math.round(span / (parts * 3)));
    const s = Math.max(start + 2, Math.round(target - window));
    const e = Math.min(end - 2, Math.round(target + window));
    let best = Math.round(target);
    let bestVal = Number.POSITIVE_INFINITY;
    for (let x = s; x <= e; x += 1) {
      const v = profile[x];
      if (v < bestVal) {
        bestVal = v;
        best = x;
      }
    }
    cuts.push(best);
  }
  cuts.push(end);
  return cuts.sort((a, b) => a - b);
}

function median(values) {
  if (!values.length) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function kmeans1d(values, k = 3, iterations = 16) {
  if (values.length < k) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 1e-6) return null;

  const centers = Array.from({ length: k }, (_, i) => min + ((i + 0.5) * (max - min)) / k);
  const labels = new Array(values.length).fill(0);

  for (let t = 0; t < iterations; t += 1) {
    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < values.length; i += 1) {
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let j = 0; j < k; j += 1) {
        const d = Math.abs(values[i] - centers[j]);
        if (d < bestDist) {
          bestDist = d;
          best = j;
        }
      }
      labels[i] = best;
      sums[best] += values[i];
      counts[best] += 1;
    }
    for (let j = 0; j < k; j += 1) {
      if (counts[j] > 0) centers[j] = sums[j] / counts[j];
    }
  }

  const order = centers.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
  const remap = new Array(k).fill(0);
  order.forEach((v, idx) => {
    remap[v.i] = idx;
  });

  const sortedCenters = order.map((o) => o.c);
  const sortedLabels = labels.map((l) => remap[l]);
  const sortedCounts = new Array(k).fill(0);
  sortedLabels.forEach((l) => {
    sortedCounts[l] += 1;
  });

  return { centers: sortedCenters, labels: sortedLabels, counts: sortedCounts };
}

function buildGuideProfiles(dark, w, h) {
  const colEdge = new Float32Array(w);
  const rowEdge = new Float32Array(h);
  for (let y = 1; y < h; y += 1) {
    const o = y * w;
    const p = (y - 1) * w;
    for (let x = 0; x < w; x += 1) {
      rowEdge[y] += Math.abs(dark[o + x] - dark[p + x]);
    }
  }
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    for (let x = 1; x < w; x += 1) {
      colEdge[x] += Math.abs(dark[o + x] - dark[o + x - 1]);
    }
  }
  return { colEdge, rowEdge };
}

function snapBoundary(pos, profile, lo, hi, radius = 10) {
  const start = Math.max(lo, Math.round(pos - radius));
  const end = Math.min(hi, Math.round(pos + radius));
  let best = Math.round(pos);
  let bestScore = -1;
  for (let i = start; i <= end; i += 1) {
    const score = profile[i] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function getSelectedCard() {
  const page = getPage();
  if (!page) return null;
  return page.cards.find((c) => c.id === state.selectedCardId) ?? null;
}

function updateTemplateReadout() {
  if (!els.templateReadout) return;
  const fmt = (t) => (t ? Math.round(t.w) + "x" + Math.round(t.h) + " px" : "unset");
  els.templateReadout.textContent = "Templates: Front " + fmt(state.templates.front) + " | Back " + fmt(state.templates.back);
}

function updateCalibrationReadout() {
  if (!els.calibrationReadout) return;
  const a = state.frontCalibration.anchors;
  const setFlags = [a.a ? "A" : "-", a.b ? "B" : "-", a.c ? "C" : "-"].join("");
  const mode = state.frontCalibration.showOutliersOnly ? "Outliers view ON" : "Outliers view OFF";
  els.calibrationReadout.textContent = "Front calibration anchors: " + setFlags + " | " + mode;
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
  state.gridSlicer.xLines = lines.xLines;
  state.gridSlicer.yLines = lines.yLines;
  state.gridSlicer.activeLine = null;
  state.gridSlicer.bandHits = { cols: [], rows: [] };
  const cols = Math.max(1, lines.xLines.length - 1);
  const rows = Math.max(1, lines.yLines.length - 1);
  state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "card"));
  state.gridSlicer.xNorm = lines.xLines.map((v) => v / W);
  state.gridSlicer.yNorm = lines.yLines.map((v) => v / H);

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
  state.gridSlicer.xLines = lines.xLines;
  state.gridSlicer.yLines = lines.yLines;
  state.gridSlicer.xNorm = lines.xLines.map((v) => v / refPage.canvas.width);
  state.gridSlicer.yNorm = lines.yLines.map((v) => v / refPage.canvas.height);
  const cols = Math.max(1, lines.xLines.length - 1);
  const rows = Math.max(1, lines.yLines.length - 1);
  state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "card"));
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
  if (!Array.isArray(state.gridSlicer.cellTypes) || state.gridSlicer.cellTypes.length !== rows || (state.gridSlicer.cellTypes[0]||[]).length !== cols) {
    state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "card"));
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
      const base = state.gridSlicer.cellTypes[r][idx] || "card";
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
    const source = state.gridSlicer.cellTypes[idx] ? [...state.gridSlicer.cellTypes[idx]] : Array.from({ length: Math.max(1, lines.x.length - 1) }, () => "card");
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

function applyGridToPage(pageIdx, xLines, yLines, updateNorm = true) {
  const page = state.pages[pageIdx];
  if (!page?.canvas) return 0;

  const x = clampAndSortLines(xLines, page.canvas.width - 1);
  const y = clampAndSortLines(yLines, page.canvas.height - 1);
  const cols = Math.max(1, x.length - 1);
  const rows = Math.max(1, y.length - 1);
  if (!Array.isArray(state.gridSlicer.cellTypes) || state.gridSlicer.cellTypes.length !== rows || (state.gridSlicer.cellTypes[0]||[]).length !== cols) {
    state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "card"));
  }
  const cards = [];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if ((state.gridSlicer.cellTypes[r]?.[c] || "card") === "gutter") continue;
      const rect = {
        x: x[c],
        y: y[r],
        w: Math.max(8, x[c + 1] - x[c]),
        h: Math.max(8, y[r + 1] - y[r]),
      };
      cards.push(makeCard(rect, page.role === "back" ? "back" : "front", "grid"));
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
      if (!Array.isArray(state.gridSlicer.cellTypes) || state.gridSlicer.cellTypes.length !== rows || (state.gridSlicer.cellTypes[0]||[]).length !== cols) {
        state.gridSlicer.cellTypes = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "card"));
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
          const type = state.gridSlicer.cellTypes[r]?.[c] || "card";
          ctx.fillStyle = type === "gutter" ? "rgba(255,138,76,0.22)" : "rgba(35,150,215,0.10)";
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        }
      }


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

function getGridDimensions(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  let best = { cols: n, rows: 1, cost: Number.POSITIVE_INFINITY };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const waste = rows * cols - n;
    const shape = Math.abs(cols - rows);
    const cost = waste * 10 + shape;
    if (cost < best.cost) best = { cols, rows, cost };
  }
  return { cols: best.cols, rows: best.rows };
}

function assignCardsToTargets(cards, targets) {
  const centers = cards.map((c) => ({ cx: c.x + c.w / 2, cy: c.y + c.h / 2 }));
  const pairs = [];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = 0; j < targets.length; j += 1) {
      const dx = centers[i].cx - targets[j].cx;
      const dy = centers[i].cy - targets[j].cy;
      pairs.push({ i, j, d: dx * dx + dy * dy });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const out = new Array(cards.length).fill(null);
  const usedCards = new Set();
  const usedTargets = new Set();
  for (const p of pairs) {
    if (usedCards.has(p.i) || usedTargets.has(p.j)) continue;
    usedCards.add(p.i);
    usedTargets.add(p.j);
    out[p.i] = targets[p.j];
    if (usedCards.size === cards.length) break;
  }
  return out;
}

function setFrontAnchor(slot) {
  const selected = getSelectedCard();
  if (!selected) {
    setEngineStatus("Select a front card for anchor " + slot.toUpperCase());
    return;
  }
  if (selected.label !== "front") {
    setEngineStatus("Anchor must be a front card");
    return;
  }
  const pageIdx = state.currentPageIdx;
  state.frontCalibration.anchors[slot] = {
    pageIdx,
    cx: selected.x + selected.w / 2,
    cy: selected.y + selected.h / 2,
    w: selected.w,
    h: selected.h,
  };
  updateCalibrationReadout();
  setEngineStatus("Front anchor " + slot.toUpperCase() + " saved", true);
}

function calibrateFrontGrid() {
  const { a, b, c } = state.frontCalibration.anchors;
  if (!a || !b || !c) {
    setEngineStatus("Set anchors A, B, and C first");
    return { updated: 0, outliers: 0 };
  }

  let colStep = b.cx - a.cx;
  let rowStep = c.cy - a.cy;
  if (Math.abs(colStep) < 8 || Math.abs(rowStep) < 8) {
    setEngineStatus("Anchors are too close; reset and try again");
    return { updated: 0, outliers: 0 };
  }
  if (colStep < 0) colStep *= -1;
  if (rowStep < 0) rowStep *= -1;

  const fw = Math.round((a.w + b.w + c.w) / 3);
  const fh = Math.round((a.h + b.h + c.h) / 3);
  state.templates.front = { w: fw, h: fh };

  const outliersByPage = new Map();
  let updated = 0;
  let outlierCount = 0;

  for (let p = 0; p < state.pages.length; p += 1) {
    const page = state.pages[p];
    const fronts = page.cards.filter((card) => card.label === "front");
    if (!fronts.length) continue;

    const { cols, rows } = getGridDimensions(fronts.length);
    const centers = fronts.map((card) => ({ cx: card.x + card.w / 2, cy: card.y + card.h / 2 }));
    const minCx = Math.min(...centers.map((c0) => c0.cx));
    const minCy = Math.min(...centers.map((c0) => c0.cy));

    const targets = [];
    for (let r = 0; r < rows; r += 1) {
      for (let cl = 0; cl < cols; cl += 1) {
        targets.push({ cx: minCx + cl * colStep, cy: minCy + r * rowStep });
      }
    }

    const assignments = assignCardsToTargets(fronts, targets);
    const outlierIds = new Set();

    for (let i = 0; i < fronts.length; i += 1) {
      const card = fronts[i];
      const t = assignments[i] ?? { cx: centers[i].cx, cy: centers[i].cy };
      const expectedX = t.cx - fw / 2;
      const expectedY = t.cy - fh / 2;
      const dx = Math.abs(card.x - expectedX);
      const dy = Math.abs(card.y - expectedY);
      const ds = Math.abs(card.w - fw) + Math.abs(card.h - fh);

      card.x = expectedX;
      card.y = expectedY;
      card.w = fw;
      card.h = fh;
      normalizeCard(card);
      clampCard(card, page);
      updated += 1;

      if (dx > fw * 0.22 || dy > fh * 0.22 || ds > fw * 0.2) {
        outlierIds.add(card.id);
        outlierCount += 1;
      }
    }

    if (outlierIds.size) {
      outliersByPage.set(page.number, outlierIds);
    }
  }

  state.frontCalibration.outliersByPage = outliersByPage;
  updateTemplateReadout();
  return { updated, outliers: outlierCount };
}

function buildPageGuideModel(page) {
  if (page.guideModel) return page.guideModel;
  const { dark, w, h, scale } = buildDarkMask(page.canvas, 1500);
  const bounds = findContentBounds(dark, w, h);
  const { colEdge, rowEdge } = buildGuideProfiles(dark, w, h);
  page.guideModel = { scale, bounds, colEdge, rowEdge };
  return page.guideModel;
}

function bestFixedEdgeStart(profile, minBound, maxBound, targetStart, fixedLen, radius = 24) {
  const lo = Math.max(minBound, Math.round(targetStart - radius));
  const hi = Math.min(maxBound - fixedLen, Math.round(targetStart + radius));
  if (hi < lo) return Math.max(minBound, Math.min(Math.round(targetStart), maxBound - fixedLen));

  let best = Math.round(targetStart);
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let start = lo; start <= hi; start += 1) {
    const end = start + fixedLen;
    const score = (profile[start] ?? 0) + (profile[end] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return best;
}

function nearestIndex(values, target) {
  let idx = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const d = Math.abs(values[i] - target);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

function snapCardToTemplate(page, card, template, targetCenter = null) {
  if (!template || !page?.canvas) return false;
  const { scale, bounds, colEdge, rowEdge } = buildPageGuideModel(page);

  const cx = targetCenter?.cx ?? card.x + card.w / 2;
  const cy = targetCenter?.cy ?? card.y + card.h / 2;
  const tw = Math.max(8, template.w);
  const th = Math.max(8, template.h);

  const targetX0 = (cx - tw / 2) * scale;
  const targetY0 = (cy - th / 2) * scale;
  const twScaled = Math.max(8, Math.round(tw * scale));
  const thScaled = Math.max(8, Math.round(th * scale));

  const sx = bestFixedEdgeStart(colEdge, bounds.minX, bounds.maxX, targetX0, twScaled, 28);
  const sy = bestFixedEdgeStart(rowEdge, bounds.minY, bounds.maxY, targetY0, thScaled, 28);

  card.x = sx / scale;
  card.y = sy / scale;
  card.w = tw;
  card.h = th;
  normalizeCard(card);
  clampCard(card, page);
  return true;
}

function applyTemplateToCardsOnPage(page, cards, template) {
  if (!template || !cards.length) return 0;
  const centers = cards.map((c) => ({ cx: c.x + c.w / 2, cy: c.y + c.h / 2 }));

  let targets = null;
  if (cards.length >= 6 && cards.length <= 12) {
    const cols = 3;
    const rows = Math.max(2, Math.ceil(cards.length / cols));
    const kx = kmeans1d(centers.map((c) => c.cx), cols);
    const ky = kmeans1d(centers.map((c) => c.cy), rows);
    if (kx && ky) {
      const anchors = [];
      for (let r = 0; r < ky.centers.length; r += 1) {
        for (let c = 0; c < kx.centers.length; c += 1) {
          anchors.push({ cx: kx.centers[c], cy: ky.centers[r] });
        }
      }

      const assignments = [];
      for (let i = 0; i < centers.length; i += 1) {
        for (let j = 0; j < anchors.length; j += 1) {
          const dx = centers[i].cx - anchors[j].cx;
          const dy = centers[i].cy - anchors[j].cy;
          assignments.push({ i, j, d: dx * dx + dy * dy });
        }
      }
      assignments.sort((a, b) => a.d - b.d);

      targets = new Array(cards.length).fill(null);
      const usedCards = new Set();
      const usedAnchors = new Set();
      for (const a of assignments) {
        if (usedCards.has(a.i) || usedAnchors.has(a.j)) continue;
        usedCards.add(a.i);
        usedAnchors.add(a.j);
        targets[a.i] = anchors[a.j];
        if (usedCards.size === cards.length) break;
      }
    }
  }

  let updated = 0;
  for (let i = 0; i < cards.length; i += 1) {
    if (snapCardToTemplate(page, cards[i], template, targets ? targets[i] : null)) {
      updated += 1;
    }
  }
  return updated;
}

async function applyTemplatesAcrossDocument() {
  let updated = 0;
  for (let i = 0; i < state.pages.length; i += 1) {
    const page = state.pages[i];
    await ensurePageCanvas(i);
    page.guideModel = null;

    const byPageRole = page.role === "front" ? state.templates.front : page.role === "back" ? state.templates.back : null;
    if (byPageRole) {
      updated += applyTemplateToCardsOnPage(page, page.cards, byPageRole);
      continue;
    }

    if (state.templates.front) {
      const fronts = page.cards.filter((c) => c.label === "front");
      updated += applyTemplateToCardsOnPage(page, fronts, state.templates.front);
    }
    if (state.templates.back) {
      const backs = page.cards.filter((c) => c.label === "back");
      updated += applyTemplateToCardsOnPage(page, backs, state.templates.back);
    }
  }
  return updated;
}

async function runTemplateApply(trigger = "manual") {
  if (!state.templates.front && !state.templates.back) {
    setEngineStatus("Set a front or back template first");
    return;
  }

  setBusy(true, "Applying templates...");
  try {
    const updated = await applyTemplatesAcrossDocument();
    syncStats();
    drawCurrentPage();
    const suffix = trigger === "auto" ? " (auto)" : "";
    setEngineStatus("Template apply complete (" + updated + " cards adjusted)" + suffix, updated > 0);
  } catch (err) {
    console.error(err);
    setEngineStatus("Template apply failed: " + err.message);
  } finally {
    setBusy(false);
  }
}

function setTemplateFromSelected(kind) {
  const selected = getSelectedCard();
  if (!selected) {
    setEngineStatus("Select a " + kind + " card first");
    return;
  }
  state.templates[kind] = { w: selected.w, h: selected.h };
  updateTemplateReadout();
  const bothReady = !!(state.templates.front && state.templates.back);
  setEngineStatus(
    (kind === "front" ? "Front" : "Back") + " template saved" + (bothReady ? ". Auto-applying templates..." : ""),
    true,
  );
  if (bothReady) {
    runTemplateApply("auto");
  }
}
function regularizeNineGridRects(rects, canvas, mode) {
  if (rects.length < 8 || rects.length > 10) return rects;
  const centers = rects.map((r) => ({
    cx: r.x + r.w / 2,
    cy: r.y + r.h / 2,
  }));

  const xs = centers.map((c) => c.cx).sort((a, b) => a - b);
  const ys = centers.map((c) => c.cy).sort((a, b) => a - b);
  const n = centers.length;
  const group = (i) => Math.min(2, Math.floor((i * 3) / n));

  const xGroups = [[], [], []];
  const yGroups = [[], [], []];
  xs.forEach((x, i) => xGroups[group(i)].push(x));
  ys.forEach((y, i) => yGroups[group(i)].push(y));
  const colCenters = xGroups.map((g) => median(g)).sort((a, b) => a - b);
  const rowCenters = yGroups.map((g) => median(g)).sort((a, b) => a - b);

  const xStepA = colCenters[1] - colCenters[0];
  const xStepB = colCenters[2] - colCenters[1];
  const yStepA = rowCenters[1] - rowCenters[0];
  const yStepB = rowCenters[2] - rowCenters[1];
  if (xStepA <= 5 || xStepB <= 5 || yStepA <= 5 || yStepB <= 5) return rects;

  const { dark, w, h, scale } = buildDarkMask(canvas, 1500);
  const bounds = findContentBounds(dark, w, h);
  const minX = Math.max(0, Math.round(bounds.minX / scale));
  const maxX = Math.min(canvas.width - 1, Math.round(bounds.maxX / scale));
  const minY = Math.max(0, Math.round(bounds.minY / scale));
  const maxY = Math.min(canvas.height - 1, Math.round(bounds.maxY / scale));

  const vx = [
    colCenters[0] - xStepA / 2,
    (colCenters[0] + colCenters[1]) / 2,
    (colCenters[1] + colCenters[2]) / 2,
    colCenters[2] + xStepB / 2,
  ];
  const vy = [
    rowCenters[0] - yStepA / 2,
    (rowCenters[0] + rowCenters[1]) / 2,
    (rowCenters[1] + rowCenters[2]) / 2,
    rowCenters[2] + yStepB / 2,
  ];

  vx[0] = Math.max(vx[0], minX);
  vx[3] = Math.min(vx[3], maxX);
  vy[0] = Math.max(vy[0], minY);
  vy[3] = Math.min(vy[3], maxY);

  const out = [];
  const [minAspect, maxAspect] = aspectRange(mode);
  const relaxedMin = minAspect * 0.78;
  const relaxedMax = maxAspect * 1.28;

  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const x0 = vx[c];
      const x1 = vx[c + 1];
      const y0 = vy[r];
      const y1 = vy[r + 1];
      const cw = Math.max(10, x1 - x0);
      const ch = Math.max(10, y1 - y0);
      const expandX = Math.max(2, Math.round(cw * 0.015));
      const expandY = Math.max(2, Math.round(ch * 0.015));
      const rx = Math.max(0, Math.round(x0 - expandX));
      const ry = Math.max(0, Math.round(y0 - expandY));
      const rw = Math.min(canvas.width - rx, Math.round(cw + expandX * 2));
      const rh = Math.min(canvas.height - ry, Math.round(ch + expandY * 2));
      const ratio = Math.min(rw, rh) / Math.max(rw, rh);
      if (rw > 8 && rh > 8 && ratio >= relaxedMin && ratio <= relaxedMax) {
        out.push({ x: rx, y: ry, w: rw, h: rh });
      }
    }
  }

  if (out.length !== 9) return rects;
  return nmsRects(out);
}

function inferUniformNineFromAnchors(rects, canvas, minAreaPct, mode) {
  if (rects.length < 8 || rects.length > 14) return rects;
  const pageArea = canvas.width * canvas.height;
  const areas = rects.map((r) => r.w * r.h).sort((a, b) => a - b);
  const medArea = median(areas);
  if (!medArea) return rects;

  const candidates = rects.filter((r) => {
    const area = r.w * r.h;
    return area < pageArea * 0.45 && area >= medArea * 0.35 && area <= medArea * 2.3;
  });
  if (candidates.length < 6) return rects;

  const xs = candidates.map((r) => r.x + r.w / 2);
  const ys = candidates.map((r) => r.y + r.h / 2);
  const kx = kmeans1d(xs, 3);
  const ky = kmeans1d(ys, 3);
  if (!kx || !ky) return rects;
  if (Math.min(...kx.counts) < 1 || Math.min(...ky.counts) < 1) return rects;

  const colCenters = kx.centers;
  const rowCenters = ky.centers;
  const stepX = Math.min(colCenters[1] - colCenters[0], colCenters[2] - colCenters[1]);
  const stepY = Math.min(rowCenters[1] - rowCenters[0], rowCenters[2] - rowCenters[1]);
  if (stepX <= 12 || stepY <= 12) return rects;

  let width = median(candidates.map((r) => r.w));
  let height = median(candidates.map((r) => r.h));
  if (width > height) [width, height] = [height, width];

  const baseRatio = Math.min(width, height) / Math.max(width, height);
  const [minAspect, maxAspect] = aspectRange(mode);
  const targetRatio = Math.max(minAspect * 0.9, Math.min(baseRatio, maxAspect * 1.1));
  height = width / Math.max(0.01, targetRatio);
  width = Math.max(width, stepX * 0.88);
  height = Math.max(height, stepY * 0.88);
  width = Math.min(width, stepX * 0.99);
  height = Math.min(height, stepY * 0.99);

  const { dark, w, h, scale } = buildDarkMask(canvas, 1500);
  const bounds = findContentBounds(dark, w, h);
  const minX = Math.max(0, Math.round(bounds.minX / scale));
  const maxX = Math.min(canvas.width - 1, Math.round(bounds.maxX / scale));
  const minY = Math.max(0, Math.round(bounds.minY / scale));
  const maxY = Math.min(canvas.height - 1, Math.round(bounds.maxY / scale));
  const { colEdge, rowEdge } = buildGuideProfiles(dark, w, h);

  const gridMinX = colCenters[0] - width / 2;
  const gridMaxX = colCenters[2] + width / 2;
  const gridMinY = rowCenters[0] - height / 2;
  const gridMaxY = rowCenters[2] + height / 2;
  const shiftX = gridMinX < minX ? minX - gridMinX : gridMaxX > maxX ? maxX - gridMaxX : 0;
  const shiftY = gridMinY < minY ? minY - gridMinY : gridMaxY > maxY ? maxY - gridMaxY : 0;

  const out = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const cx = colCenters[c] + shiftX;
      const cy = rowCenters[r] + shiftY;
      let x0 = cx - width / 2;
      let x1 = cx + width / 2;
      let y0 = cy - height / 2;
      let y1 = cy + height / 2;

      const sx0 = snapBoundary(x0 * scale, colEdge, bounds.minX, bounds.maxX, 16) / scale;
      const sx1 = snapBoundary(x1 * scale, colEdge, bounds.minX, bounds.maxX, 16) / scale;
      const sy0 = snapBoundary(y0 * scale, rowEdge, bounds.minY, bounds.maxY, 16) / scale;
      const sy1 = snapBoundary(y1 * scale, rowEdge, bounds.minY, bounds.maxY, 16) / scale;
      if (Math.abs(sx1 - sx0) > 12 && Math.abs(sy1 - sy0) > 12) {
        x0 = sx0;
        x1 = sx1;
        y0 = sy0;
        y1 = sy1;
      }

      const rx = Math.max(0, Math.round(Math.min(x0, x1)));
      const ry = Math.max(0, Math.round(Math.min(y0, y1)));
      const rw = Math.max(8, Math.round(Math.abs(x1 - x0)));
      const rh = Math.max(8, Math.round(Math.abs(y1 - y0)));
      const clampedW = Math.min(rw, canvas.width - rx);
      const clampedH = Math.min(rh, canvas.height - ry);
      out.push({ x: rx, y: ry, w: clampedW, h: clampedH });
    }
  }

  const minArea = (minAreaPct / 100) * canvas.width * canvas.height;
  const valid = out.filter((r) => r.w * r.h >= minArea);
  if (valid.length !== 9) return rects;
  return nmsRects(valid);
}

function detectGrid3x3Rects(canvas, minAreaPct, mode, opts = {}) {
  const force = !!opts.force;
  const { dark, w, h, scale } = buildDarkMask(canvas, 1500);
  const { minX, maxX, minY, maxY, colCounts, rowCounts } = findContentBounds(dark, w, h);
  const xCuts = findSplitCuts(colCounts, minX, maxX, 3);
  const yCuts = findSplitCuts(rowCounts, minY, maxY, 3);

  const [minAspect, maxAspect] = aspectRange(mode);
  const relaxedMin = minAspect * 0.7;
  const relaxedMax = maxAspect * 1.35;
  const minArea = (minAreaPct / 100) * canvas.width * canvas.height;
  const rects = [];

  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const x0 = xCuts[c];
      const x1 = xCuts[c + 1];
      const y0 = yCuts[r];
      const y1 = yCuts[r + 1];
      const cw = Math.max(1, x1 - x0);
      const ch = Math.max(1, y1 - y0);
      const padX = force ? Math.max(0, Math.round(cw * 0.0)) : Math.max(1, Math.round(cw * 0.01));
      const padY = force ? Math.max(0, Math.round(ch * 0.0)) : Math.max(1, Math.round(ch * 0.01));
      const sx = x0 - padX;
      const sy = y0 - padY;
      const sw = Math.max(12, cw + padX * 2);
      const sh = Math.max(12, ch + padY * 2);

      const ratio = Math.min(sw, sh) / Math.max(sw, sh);
      const rx = Math.max(0, Math.round(sx / scale));
      const ry = Math.max(0, Math.round(sy / scale));
      const rw = Math.min(canvas.width - rx, Math.round(sw / scale));
      const rh = Math.min(canvas.height - ry, Math.round(sh / scale));
      const area = rw * rh;

      if (force || (area >= minArea && ratio >= relaxedMin && ratio <= relaxedMax)) {
        rects.push({ x: rx, y: ry, w: rw, h: rh });
      }
    }
  }

  if (force && rects.length !== 9) {
    const full = [];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const x0 = minX + ((maxX - minX) * c) / 3;
        const x1 = minX + ((maxX - minX) * (c + 1)) / 3;
        const y0 = minY + ((maxY - minY) * r) / 3;
        const y1 = minY + ((maxY - minY) * (r + 1)) / 3;
        const rx = Math.max(0, Math.round(x0 / scale));
        const ry = Math.max(0, Math.round(y0 / scale));
        const rw = Math.max(8, Math.round((x1 - x0) / scale));
        const rh = Math.max(8, Math.round((y1 - y0) / scale));
        full.push({ x: rx, y: ry, w: Math.min(rw, canvas.width - rx), h: Math.min(rh, canvas.height - ry) });
      }
    }
    return nmsRects(full);
  }

  return nmsRects(rects);
}

function isPageSizedDetection(rects, canvas) {
  if (!rects.length) return true;
  const pageArea = canvas.width * canvas.height;
  const largest = rects.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
  const largestPct = (largest.w * largest.h) / pageArea;
  return rects.length <= 2 && largestPct >= 0.6;
}

function shouldTryGridRecovery(rects, canvas) {
  if (!rects.length) return true;
  if (rects.length >= 9) return false;
  return isPageSizedDetection(rects, canvas);
}

async function detectPage(pageIdx) {
  const page = state.pages[pageIdx];
  await ensurePageCanvas(pageIdx);
  const minArea = Number(els.minAreaInput.value || 1);
  const mode = els.aspectModeSelect.value;

  let rects = [];
  if (state.cvReady) {
    rects = detectCardsCv(page.canvas, minArea, mode);
  }
  if (!rects.length) {
    rects = detectCardsFallback(page.canvas, minArea, mode);
  }
  if (shouldTryGridRecovery(rects, page.canvas)) {
    const gridRects = detectGrid3x3Rects(page.canvas, minArea, mode);
    if (gridRects.length >= 8) {
      rects = gridRects;
    }
  }
  rects = regularizeNineGridRects(rects, page.canvas, mode);
  rects = inferUniformNineFromAnchors(rects, page.canvas, minArea, mode);

  if (isPageSizedDetection(rects, page.canvas) || rects.length < 8) {
    const forced = detectGrid3x3Rects(page.canvas, Math.min(minArea, 0.2), mode, { force: true });
    if (forced.length >= 8) {
      rects = regularizeNineGridRects(forced, page.canvas, mode);
      rects = inferUniformNineFromAnchors(rects, page.canvas, Math.min(minArea, 0.2), mode);
    }
  }

  page.cards = rects.map((r) => makeCard(r, page.role, "auto"));
  state.selectedCardId = page.cards[0]?.id ?? null;
}

function getPage() {
  return state.pages[state.currentPageIdx];
}

function drawCard(card, selected = false) {
  const s = state.canvasScale;
  const x = card.x * s;
  const y = card.y * s;
  const w = card.w * s;
  const h = card.h * s;

  ctx.save();
  ctx.lineWidth = selected ? 3 : 2;
  const stroke = card.label === "back" ? "#2f6d6b" : "#db4f27";
  ctx.strokeStyle = stroke;
  ctx.fillStyle = selected ? "rgba(255, 255, 255, 0.28)" : "transparent";
  ctx.strokeRect(x, y, w, h);
  if (selected) ctx.fillRect(x, y, w, h);

  ctx.fillStyle = stroke;
  ctx.font = "600 12px Space Grotesk";
  ctx.fillText(`${card.label.toUpperCase()} ${card.rotation ? `(${card.rotation}°)` : ""}`.trim(), x + 4, y + 14);

  if (selected) {
    const hs = Math.max(8, Math.round(getHitRadii(state.lastPointerType).drawHandle));
    const handles = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
    ];
    ctx.fillStyle = "#fff";
    handles.forEach(([hx, hy]) => {
      ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
      ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2);
    });
  }

  ctx.restore();
}

function drawCurrentPage() {
  const page = getPage();
  if (!page?.canvas) return;

  const wrap = els.pageCanvas.parentElement;
  const wrapStyles = wrap ? getComputedStyle(wrap) : null;
  const padX = wrapStyles
    ? (parseFloat(wrapStyles.paddingLeft || "0") + parseFloat(wrapStyles.paddingRight || "0"))
    : 24;
  const availableW = wrap ? Math.max(260, wrap.clientWidth - padX) : 1200;
  const availableH = Math.max(320, window.innerHeight * 0.68);
  const fit = Math.min(availableW / page.canvas.width, availableH / page.canvas.height, 1);
  state.canvasScale = fit;

  els.pageCanvas.width = Math.max(1, Math.round(page.canvas.width * fit));
  els.pageCanvas.height = Math.max(1, Math.round(page.canvas.height * fit));

  ctx.clearRect(0, 0, els.pageCanvas.width, els.pageCanvas.height);
  ctx.drawImage(page.canvas, 0, 0, els.pageCanvas.width, els.pageCanvas.height);

  drawGridOverlay(page);

  if (state.gridSlicer.awaitingBounds && state.gridSlicer.refPageIdx === state.currentPageIdx) {
    els.selectionReadout.textContent = "Step 2: Draw one box around the full card layout area.";
  } else if (state.gridSlicer.active && state.gridSlicer.refPageIdx === state.currentPageIdx) {
    els.selectionReadout.textContent = "Step 3: Drag divider lines, then click spacing regions you want excluded.";
  } else {
    els.selectionReadout.textContent = "Step 4: Apply the grid to all pages, then build ZIP.";
  }

  updateTemplateReadout();
  updateCalibrationReadout();
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

function nearestResizeHandle(mx, my, x, y, w, h, edgeBand) {
  const cornerBand = edgeBand * 1.25;
  const nearLeft = Math.abs(mx - x) <= edgeBand;
  const nearRight = Math.abs(mx - (x + w)) <= edgeBand;
  const nearTop = Math.abs(my - y) <= edgeBand;
  const nearBottom = Math.abs(my - (y + h)) <= edgeBand;

  if (Math.abs(mx - x) <= cornerBand && Math.abs(my - y) <= cornerBand) return "tl";
  if (Math.abs(mx - (x + w)) <= cornerBand && Math.abs(my - y) <= cornerBand) return "tr";
  if (Math.abs(mx - (x + w)) <= cornerBand && Math.abs(my - (y + h)) <= cornerBand) return "br";
  if (Math.abs(mx - x) <= cornerBand && Math.abs(my - (y + h)) <= cornerBand) return "bl";

  if (nearTop) return "tm";
  if (nearRight) return "rm";
  if (nearBottom) return "bm";
  if (nearLeft) return "lm";
  return null;
}

function hitTestCard(mx, my, pointerType = state.lastPointerType) {
  const page = getPage();
  const s = state.canvasScale;
  const hit = getHitRadii(pointerType);
  const cornerRadius = hit.corner;
  const edgeRadius = hit.edge;
  const pickRadius = hit.pick;
  const cards = [...page.cards].reverse();

  const checkCard = (card, prioritizeResize = false) => {
    const x = card.x * s;
    const y = card.y * s;
    const w = card.w * s;
    const h = card.h * s;
    const handles = [
      { type: "tl", x, y },
      { type: "tr", x: x + w, y },
      { type: "br", x: x + w, y: y + h },
      { type: "bl", x, y: y + h },
      { type: "tm", x: x + w / 2, y },
      { type: "rm", x: x + w, y: y + h / 2 },
      { type: "bm", x: x + w / 2, y: y + h },
      { type: "lm", x, y: y + h / 2 },
    ];

    const handle = handles.find((hnd) => {
      const radius = hnd.type.endsWith("m") ? edgeRadius : cornerRadius;
      const dx = mx - hnd.x;
      const dy = my - hnd.y;
      return dx * dx + dy * dy <= radius * radius;
    });
    if (handle) {
      return { card, handle: handle.type };
    }

    const inPick = mx >= x - pickRadius && mx <= x + w + pickRadius && my >= y - pickRadius && my <= y + h + pickRadius;
    if (!inPick) return null;

    if (prioritizeResize) {
      const near = nearestResizeHandle(mx, my, x, y, w, h, edgeRadius);
      if (near) return { card, handle: near };
    }

    return { card, handle: "move" };
  };

  if (state.selectedCardId) {
    const selected = page.cards.find((c) => c.id === state.selectedCardId);
    if (selected) {
      const selHit = checkCard(selected, true);
      if (selHit) return selHit;
    }
  }

  for (const card of cards) {
    const otherHit = checkCard(card, false);
    if (otherHit) return otherHit;
  }
  return null;
}

function isNearSelected(mx, my, pointerType = state.lastPointerType) {
  const page = getPage();
  const selected = page.cards.find((c) => c.id === state.selectedCardId);
  if (!selected) return false;
  const s = state.canvasScale;
  const x = selected.x * s;
  const y = selected.y * s;
  const w = selected.w * s;
  const h = selected.h * s;
  const pad = getHitRadii(pointerType).nearPad;
  return mx >= x - pad && mx <= x + w + pad && my >= y - pad && my <= y + h + pad;
}
function cursorForHandle(handle) {
  if (handle === "tl" || handle === "br") return "nwse-resize";
  if (handle === "tr" || handle === "bl") return "nesw-resize";
  if (handle === "tm" || handle === "bm") return "ns-resize";
  if (handle === "lm" || handle === "rm") return "ew-resize";
  if (handle === "move") return "move";
  return "default";
}

function normalizeCard(card) {
  if (card.w < 0) {
    card.x += card.w;
    card.w *= -1;
  }
  if (card.h < 0) {
    card.y += card.h;
    card.h *= -1;
  }
  card.w = Math.max(8, card.w);
  card.h = Math.max(8, card.h);
}

function clampCard(card, page) {
  card.x = Math.max(0, Math.min(card.x, page.canvas.width - 4));
  card.y = Math.max(0, Math.min(card.y, page.canvas.height - 4));
  card.w = Math.min(card.w, page.canvas.width - card.x);
  card.h = Math.min(card.h, page.canvas.height - card.y);
}

function toggleSelectedLabel() {
  const page = getPage();
  const card = page.cards.find((c) => c.id === state.selectedCardId);
  if (!card) return;
  card.label = card.label === "front" ? "back" : "front";
  syncStats();
  drawCurrentPage();
}

function rotateSelected(delta) {
  const page = getPage();
  const card = page.cards.find((c) => c.id === state.selectedCardId);
  if (!card) return;
  card.rotation = ((card.rotation + delta) % 360 + 360) % 360;
  drawCurrentPage();
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

function autoClassifyLikelyBacks() {
  const fingerprints = new Map();
  for (const page of state.pages) {
    for (const card of page.cards) {
      const crop = cropCardToCanvas(page.canvas, card, 0);
      const h = simpleHashCanvas(crop);
      const arr = fingerprints.get(h) ?? [];
      arr.push(card);
      fingerprints.set(h, arr);
    }
  }

  let largest = [];
  for (const cluster of fingerprints.values()) {
    if (cluster.length > largest.length) largest = cluster;
  }

  const total = state.pages.reduce((a, p) => a + p.cards.length, 0);
  if (largest.length >= Math.max(2, Math.round(total * 0.12))) {
    for (const card of largest) card.label = "back";
    for (const page of state.pages) {
      for (const card of page.cards) {
        if (!largest.includes(card) && card.label !== "back") card.label = "front";
      }
    }
  }
}

function hammingDistanceBits(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) d += 1;
  }
  return d;
}

function estimateIdenticalBacks() {
  const backs = [];
  for (const page of state.pages) {
    for (const card of page.cards) {
      if (card.label !== "back") continue;
      const crop = cropCardToCanvas(page.canvas, card, 0);
      backs.push(simpleHashCanvas(crop));
    }
  }

  if (backs.length < 2) return false;
  let matches = 0;
  let pairs = 0;
  for (let i = 0; i < backs.length; i += 1) {
    for (let j = i + 1; j < backs.length; j += 1) {
      pairs += 1;
      if (hammingDistanceBits(backs[i], backs[j]) <= 12) {
        matches += 1;
      }
    }
  }

  if (!pairs) return false;
  return matches / pairs >= 0.7;
}

async function autodetectAll() {
  if (!state.cvReady && window.cv && typeof window.cv.imread === "function") {
    state.cvReady = true;
  }

  setBusy(true, "Detecting cards…");
  try {
    let total = 0;
    for (let i = 0; i < state.pages.length; i += 1) {
      setEngineStatus(`Detecting page ${i + 1}/${state.pages.length}`);
      await detectPage(i);
      total += state.pages[i].cards.length;
    }
    autoClassifyLikelyBacks();
    const likelySameBacks = estimateIdenticalBacks();
    if (els.singleBackToggle) {
      els.singleBackToggle.checked = likelySameBacks;
    }
    els.pageRoleSelect.value = getPage().role;
    syncStats();
    drawCurrentPage();
    setEngineStatus(
      total > 0
        ? `Detection complete (${total} boxes). Optional: draw a grid area on the preview and apply the grid to all pages for consistent slicing.${likelySameBacks ? " Backs look identical; single-back export is preselected." : ""}`
        : "No cards detected (try grid setup or lower Min card area)",
      total > 0,
    );
  } catch (err) {
    console.error(err);
    setEngineStatus(`Detection failed: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

function scoreBackCandidate(page, card) {
  let score = card.w * card.h;
  if (state.templates.back) {
    score -= Math.abs(card.w - state.templates.back.w) * 40;
    score -= Math.abs(card.h - state.templates.back.h) * 40;
  }
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

  const bleedIn = Number(els.bleedSelect?.value || 0);
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
    if (state.templates.back) {
      snapCardToTemplate(bestBack.page, bestBack.card, state.templates.back);
    }
    let crop = cropCardToCanvas(bestBack.page.canvas, bestBack.card, bestBack.bleedPx);
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
  els.pdfInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
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
  });

  els.pageSelect.addEventListener("change", async () => {
    state.currentPageIdx = Number(els.pageSelect.value);
    state.selectedCardId = null;
    els.pageRoleSelect.value = getPage().role;
    await ensurePageCanvas(state.currentPageIdx);
    drawCurrentPage();
  });

  els.pageRoleSelect.addEventListener("change", () => applyPageRole(els.pageRoleSelect.value));
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


  if (els.autodetectBtn) {
    els.autodetectBtn.addEventListener("click", autodetectAll);
  }
  if (els.resetPageBtn) {
    els.resetPageBtn.addEventListener("click", async () => {
      const i = state.currentPageIdx;
      await detectPage(i);
      syncStats();
      drawCurrentPage();
    });
  }

  if (els.setFrontTemplateBtn) {
    els.setFrontTemplateBtn.addEventListener("click", () => setTemplateFromSelected("front"));
  }
  if (els.setBackTemplateBtn) {
    els.setBackTemplateBtn.addEventListener("click", () => setTemplateFromSelected("back"));
  }
  if (els.applyTemplatesBtn) {
    els.applyTemplatesBtn.addEventListener("click", () => {
      runTemplateApply("manual");
    });
  }
  if (els.setAnchorABtn) {
    els.setAnchorABtn.addEventListener("click", () => setFrontAnchor("a"));
  }
  if (els.setAnchorBBtn) {
    els.setAnchorBBtn.addEventListener("click", () => setFrontAnchor("b"));
  }
  if (els.setAnchorCBtn) {
    els.setAnchorCBtn.addEventListener("click", () => setFrontAnchor("c"));
  }
  if (els.calibrateFrontGridBtn) {
    els.calibrateFrontGridBtn.addEventListener("click", () => {
      const result = calibrateFrontGrid();
      syncStats();
      drawCurrentPage();
      setEngineStatus(
        "Front grid calibrated (" + result.updated + " cards adjusted, " + result.outliers + " outliers)",
        result.updated > 0,
      );
    });
  }
  if (els.toggleOutliersBtn) {
    els.toggleOutliersBtn.addEventListener("click", () => {
      state.frontCalibration.showOutliersOnly = !state.frontCalibration.showOutliersOnly;
      els.toggleOutliersBtn.textContent = state.frontCalibration.showOutliersOnly ? "Show All Cards" : "Show Front Outliers";
      drawCurrentPage();
    });
  }

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
      const current = state.gridSlicer.cellTypes?.[bandHit.row]?.[bandHit.col] || "card";
      const mode = current === "gutter" ? "card" : "gutter";
      state.gridSlicer.cellTypes[bandHit.row][bandHit.col] = mode;
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
    setEngineStatus("Loading engines…");
    bindEvents();
    updateTemplateReadout();
    updateCalibrationReadout();
    updateGridReadout();
    updateActionStates();

    state.cvReady = await waitForOpenCv();
    if (state.cvReady) {
      setEngineStatus("Ready", true);
    } else {
      setEngineStatus("OpenCV unavailable (manual mode)");
    }
  } catch (err) {
    console.error(err);
    setEngineStatus("Init failed: " + (err?.message || String(err)));
  }
}

init();
