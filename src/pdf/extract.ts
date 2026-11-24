/**
 * pdf/extract.ts — the single entry point of the deterministic PDF layer.
 *
 * WHAT:   Opens a PDF and, page by page, collects text spans, widgets (form fields) and
 *         rules (drawn lines/boxes) into a PdfDoc. Coordinates are rounded to 0.1pt.
 * INPUT:  path to a PDF file
 * OUTPUT: PdfDoc (see types.ts)
 * USED BY: src/cli/dump-page.ts, src/grounding/*, src/agents/input-extraction/*
 */
import { basename } from "node:path";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdf } from "./load.js";
import { getSpanDrafts, numberSpans } from "./lines.js";
import { getWidgets, linkValueSpans } from "./widgets.js";
import { getRules } from "./graphics.js";
import type { Box, PdfDoc, PdfPage } from "./types.js";

/** Round to one decimal place. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round every number of a box. */
function roundBox(b: Box): Box {
  return { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
}

/** Extract one page. */
async function extractPage(page: PDFPageProxy, pageNumber: number): Promise<PdfPage> {
  const [left, bottom, right, top] = page.view;
  const textDrafts = await getSpanDrafts(page);
  const { widgets, valueDrafts } = await getWidgets(page, pageNumber);
  // Text and widget-value spans are numbered together, so reading order is purely positional.
  const spans = numberSpans(pageNumber, [...textDrafts, ...valueDrafts]);
  linkValueSpans(widgets, spans);
  const rules = await getRules(page, pageNumber);

  for (const s of spans) {
    s.box = roundBox(s.box);
    s.fontSize = r1(s.fontSize);
  }
  for (const w of widgets) w.box = roundBox(w.box);
  for (const r of rules) r.box = roundBox(r.box);
  return { page: pageNumber, width: r1(right - left), height: r1(top - bottom), spans, widgets, rules };
}

/**
 * Extract the whole PDF.
 * Example: `const doc = await extractPdf("sample-forms/event-of-death-en.pdf")`
 *          → doc.pageCount === 3, doc.pages[0].spans[0].id === "p1.s1".
 */
export async function extractPdf(path: string): Promise<PdfDoc> {
  const pdf = await loadPdf(path);
  const pages: PdfPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push(await extractPage(await pdf.getPage(n), n));
  }
  return {
    sourceFile: basename(path),
    pageCount: pages.length,
    isAcroForm: pages.some((p) => p.widgets.length > 0),
    pages,
  };
}
