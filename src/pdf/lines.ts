/**
 * pdf/lines.ts — turn pdf.js text items into spans (runs of text with one style on one line).
 *
 * WHAT:   pdf.js returns text in small fragments (often one per word or per font switch).
 *         We (1) convert each fragment to top-left coordinates, (2) group fragments on the
 *         same baseline into visual lines, (3) merge neighbours into one span unless
 *         something separates them (big gap, font-size change, bold change).
 *         Finally `numberSpans` sorts everything in reading order and assigns IDs.
 * INPUT:  a pdf.js page (getSpanDrafts) / a list of drafts (numberSpans)
 * OUTPUT: SpanDraft[] (no id/line yet) → Span[] (with ids "p1.s14" and line numbers)
 * USED BY: src/pdf/extract.ts, src/pdf/widgets.ts (builds drafts for pre-filled values)
 */
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Span } from "./types.js";

/** A span before it has an id and a line number. */
export interface SpanDraft {
  text: string;
  box: { x: number; y: number; w: number; h: number };
  fontSize: number;
  bold: boolean;
  source: "text" | "widget";
  widgetId: string | null;
  /** y of the text baseline (top-left origin). Used to decide which items share a line. */
  baseline: number;
  /** Rotated text (e.g. a barcode number in the margin). Sorted after all horizontal text. */
  vertical: boolean;
}

/** One pdf.js text fragment, converted to top-left coordinates. Internal. */
interface Atom {
  text: string;
  x: number;
  right: number;
  baseline: number;
  fontSize: number;
  bold: boolean;
}

// ---- thresholds (all in points) -------------------------------------------------

/** Two fragments share a line if their baselines differ by less than this × font size.
 *  0.5 is large enough to keep a superscript marker (raised ~0.35 em) on its parent's line,
 *  and small enough to never merge two real lines (line pitch is ≥ 1.1 em). */
const SAME_LINE_TOLERANCE = 0.5;

/** A horizontal gap wider than this × font size starts a new span.
 *  A normal word space is ~0.25 em; label/column gaps are several em. 1.0 em
 *  separates "Last name" from "First name(s)" without splitting ordinary text. */
const MAX_GAP_EM = 1.0;

/** A gap wider than this × font size gets a single space inserted when the PDF has no
 *  space character there (pdf.js drops whitespace-only fragments, the gap is all we see). */
const SPACE_GAP_EM = 0.12;

/** Font sizes closer than this (pt) count as the same size. */
const SAME_SIZE_PT = 0.5;

/** Font names containing one of these are bold, e.g. "Frutiger45LightBold", "Arial-Black". */
const BOLD_PATTERN = /bold|black|heavy|semibold|demi/i;

// ---- step 1: pdf.js items → atoms ---------------------------------------------------

/** True when the font name says bold. Example: isBoldFontName("ABC+Frutiger,Bold") → true. */
export function isBoldFontName(name: string | undefined): boolean {
  return name !== undefined && BOLD_PATTERN.test(name);
}

/** Look up the real font name of a pdf.js font id (needs fontExtraProperties, see load.ts). */
function realFontName(page: PDFPageProxy, fontId: string): string | undefined {
  try {
    return page.commonObjs.get(fontId)?.name;
  } catch {
    return undefined;
  }
}

/** Map every font id used on the page to "is it bold?". Needs the operator list loaded first. */
async function boldByFontId(page: PDFPageProxy, fontIds: string[]): Promise<Map<string, boolean>> {
  await page.getOperatorList(); // loads fonts into page.commonObjs
  const result = new Map<string, boolean>();
  for (const id of fontIds) result.set(id, isBoldFontName(realFontName(page, id)));
  return result;
}

/** Round to one decimal. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Minimal shape of a pdf.js text item we rely on. */
interface RawItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
}

/**
 * Convert one pdf.js item to a SpanDraft if it is rotated 90° (vertical text), else null.
 * pdf.js transform for text running upwards is [0, s, -s, 0, x, y].
 */
function verticalDraft(item: RawItem, bold: boolean, viewTop: number, viewLeft: number): SpanDraft | null {
  const [a, b, c, , tx, ty] = item.transform;
  if (Math.abs(a) > Math.abs(b)) return null;
  const size = Math.hypot(a, b);
  // Text runs upward, glyph "up" points left: the box sits left of the baseline x.
  const x = tx - viewLeft - (c < 0 ? 0.8 * size : -0.2 * size);
  const y = viewTop - (ty + (b > 0 ? item.width : 0));
  return {
    text: item.str.trim(),
    box: { x, y, w: size, h: item.width },
    fontSize: size,
    bold,
    source: "text",
    widgetId: null,
    baseline: y,
    vertical: true,
  };
}

/** Convert one horizontal pdf.js item to an Atom (top-left coordinates). */
function toAtom(item: RawItem, bold: boolean, viewTop: number, viewLeft: number): Atom {
  const [a, b, , , tx, ty] = item.transform;
  const x = tx - viewLeft;
  return {
    text: item.str,
    x,
    right: x + item.width,
    baseline: viewTop - ty,
    fontSize: Math.hypot(a, b),
    bold,
  };
}

// ---- step 2: atoms → lines → spans ------------------------------------------------

/** Group atoms into visual lines by baseline; each line is sorted left-to-right. */
export function groupIntoLines(atoms: Atom[]): Atom[][] {
  const sorted = [...atoms].sort((p, q) => p.baseline - q.baseline);
  const lines: Atom[][] = [];
  for (const atom of sorted) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    const sameLine = ref && Math.abs(atom.baseline - ref.baseline) < SAME_LINE_TOLERANCE * Math.max(atom.fontSize, ref.fontSize);
    if (line && sameLine) line.push(atom);
    else lines.push([atom]);
  }
  return lines.map((line) => line.sort((p, q) => p.x - q.x));
}

/** True if `next` must start a new span after `current` (gap, size change, bold change). */
function startsNewSpan(current: Atom, next: Atom): boolean {
  const gap = next.x - current.right;
  const size = Math.max(current.fontSize, next.fontSize);
  return (
    gap > MAX_GAP_EM * size ||
    Math.abs(next.fontSize - current.fontSize) > SAME_SIZE_PT ||
    next.bold !== current.bold
  );
}

/** Text to insert between two merged atoms: "" or one space (see SPACE_GAP_EM). */
function joiner(current: Atom, next: Atom): string {
  const gap = next.x - current.right;
  const hasSpace = /\s$/.test(current.text) || /^\s/.test(next.text);
  return gap > SPACE_GAP_EM * next.fontSize && !hasSpace ? " " : "";
}

/** Merge one visual line of atoms into spans. */
export function mergeLine(line: Atom[]): SpanDraft[] {
  const drafts: SpanDraft[] = [];
  let group: Atom[] = [];
  const flush = () => {
    if (group.length > 0) drafts.push(atomsToDraft(group));
    group = [];
  };
  for (const atom of line) {
    const last = group[group.length - 1];
    if (last && startsNewSpan(last, atom)) flush();
    group.push(atom);
  }
  flush();
  return drafts;
}

/** Combine a group of atoms (already known to belong together) into one draft. */
function atomsToDraft(group: Atom[]): SpanDraft {
  let text = group[0].text;
  for (let i = 1; i < group.length; i++) text += joiner(group[i - 1], group[i]) + group[i].text;
  const first = group[0];
  const last = group[group.length - 1];
  const size = first.fontSize;
  // Glyph box: ~0.8 em above the baseline, ~0.2 em below (tighter than the font's
  // ascent/descent so neighbouring lines never overlap).
  return {
    text: text.trim(),
    box: { x: first.x, y: first.baseline - 0.8 * size, w: last.right - first.x, h: size },
    fontSize: size,
    bold: first.bold,
    source: "text",
    widgetId: null,
    baseline: first.baseline,
    vertical: false,
  };
}

// ---- public API -------------------------------------------------------------------

/**
 * Read the page's text layer and return span drafts (not yet numbered).
 * Example: a row "Last name      First name(s)" gives two drafts.
 */
export async function getSpanDrafts(page: PDFPageProxy): Promise<SpanDraft[]> {
  const content = await page.getTextContent();
  const items = content.items.filter((it): it is Extract<typeof it, { str: string }> => "str" in it);
  const kept = items.filter((it) => it.str.trim() !== "") as unknown as RawItem[];
  const bold = await boldByFontId(page, [...new Set(kept.map((it) => it.fontName))]);
  const [left, , , top] = page.view; // view = [x0, y0, x1, y1] in PDF space; top = y1

  const atoms: Atom[] = [];
  const drafts: SpanDraft[] = [];
  for (const item of kept) {
    const isBold = bold.get(item.fontName) ?? false;
    const vertical = verticalDraft(item, isBold, top, left);
    if (vertical) drafts.push(vertical);
    else atoms.push(toAtom(item, isBold, top, left));
  }
  for (const line of groupIntoLines(atoms)) drafts.push(...mergeLine(line));
  return drafts;
}

/**
 * Sort drafts in reading order and give them ids and line numbers.
 * Order: horizontal text by line (top to bottom), then x; vertical text last.
 * Example: numberSpans(1, drafts)[0].id === "p1.s1".
 */
export function numberSpans(page: number, drafts: SpanDraft[]): Span[] {
  const horizontal = drafts.filter((d) => !d.vertical);
  const vertical = drafts.filter((d) => d.vertical).sort((p, q) => p.box.y - q.box.y);

  const ordered: { draft: SpanDraft; line: number }[] = [];
  let line = -1;
  let lineBaseline = -Infinity;
  for (const draft of horizontal.sort((p, q) => p.baseline - q.baseline)) {
    if (draft.baseline - lineBaseline >= SAME_LINE_TOLERANCE * draft.fontSize) {
      line++;
      lineBaseline = draft.baseline;
    }
    ordered.push({ draft, line });
  }
  // Within a line: left to right. (Sort is stable, so lines keep their order.)
  ordered.sort((p, q) => p.line - q.line || p.draft.box.x - q.draft.box.x);
  for (const v of vertical) ordered.push({ draft: v, line: ++line });

  return ordered.map(({ draft, line: lineNo }, i) => ({
    id: `p${page}.s${i + 1}`,
    page,
    text: draft.text,
    box: draft.box,
    fontSize: draft.fontSize,
    bold: draft.bold,
    line: lineNo,
    source: draft.source,
    widgetId: draft.widgetId,
  }));
}
