/**
 * pdf/graphics.ts — find drawn lines and boxes on a page.
 *
 * WHAT:   Walks the page's drawing instructions (pdf.js "operator list"), tracks the
 *         coordinate transform (save/restore/transform), and collects:
 *           - horizontal lines  (field underlines, separators)
 *           - vertical lines
 *           - boxes             (input rectangles, checkbox squares, shaded areas)
 *         Very thin filled/stroked rectangles count as lines (many PDFs draw underlines
 *         as 0.5pt-high rectangles). Clip paths and page-sized rectangles are ignored.
 * INPUT:  a pdf.js page, the page number
 * OUTPUT: Rule[] sorted top-to-bottom then left-to-right, ids "p1.r1", "p1.r2", ...
 * USED BY: src/pdf/extract.ts
 *
 * pdf.js 6 "constructPath" arguments: [drawOp, [pathData], minMax] where pathData is a flat
 * number array: 0,x,y = moveTo; 1,x,y = lineTo; 2,x1,y1,x2,y2,x,y = curveTo;
 * 3,x1,y1,x,y = quadraticCurveTo; 4 = closePath. drawOp is the paint operator
 * (stroke, fill, ..., or endPath for clip paths).
 */
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Rule } from "./types.js";

type Matrix = [number, number, number, number, number, number];
interface Point {
  x: number;
  y: number;
}
interface Subpath {
  points: Point[];
}
/** A rule without id (id is assigned after sorting). */
type RuleDraft = Omit<Rule, "id" | "page">;

// ---- thresholds (points) ------------------------------------------------------------

/** Lines shorter than this are decoration (table ticks, glyph parts), not field underlines. */
const MIN_LINE_LENGTH = 20;
/** A rectangle at most this thick is treated as a line. */
const MAX_LINE_THICKNESS = 2;
/** A line segment is "horizontal" if its y changes less than this. */
const AXIS_TOLERANCE = 0.5;
/** Boxes smaller than this in either direction are ignored (bullets, glyph bits). */
const MIN_BOX_SIDE = 4;
/** Rectangles covering more than this share of the page in both directions are backgrounds. */
const PAGE_SIZED = 0.9;
/** Two rules of one orientation whose edges all lie within this are duplicates. */
const DEDUPE_TOLERANCE = 1;

const STROKE_OPS: number[] = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
const FILL_OPS: number[] = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];

// ---- matrices -----------------------------------------------------------------------

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Combine: apply `m` first, then `n` (how PDF's `cm` operator composes). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Apply a matrix to a point. */
export function applyMatrix(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// ---- path decoding ------------------------------------------------------------------

/** Number of coordinates that follow each path command code. */
const COORDS_AFTER: Record<number, number> = { 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 };

/**
 * Decode pdf.js path data into subpaths of points (in user space, then transformed).
 * Curves keep only their end point (we never use curves as rules).
 */
export function decodePath(data: ArrayLike<number>, ctm: Matrix): Subpath[] {
  const subpaths: Subpath[] = [];
  let i = 0;
  while (i < data.length) {
    const code = data[i];
    const n = COORDS_AFTER[code] ?? 0;
    if (code === 4) {
      i += 1;
      continue;
    }
    // The end point is always the last two numbers of the command.
    const p = applyMatrix(ctm, data[i + n - 1], data[i + n]);
    if (code === 0 || subpaths.length === 0) subpaths.push({ points: [p] });
    else subpaths[subpaths.length - 1].points.push(p);
    i += 1 + n;
  }
  return subpaths;
}

// ---- shapes → rules -----------------------------------------------------------------

/** If the subpath is an axis-aligned rectangle (4 corners, optionally repeated), return its bounds. */
export function asRectangle(sub: Subpath): { x: number; y: number; w: number; h: number } | null {
  let pts = sub.points;
  if (pts.length === 5 && Math.hypot(pts[0].x - pts[4].x, pts[0].y - pts[4].y) < 0.01) pts = pts.slice(0, 4);
  if (pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > AXIS_TOLERANCE && Math.abs(a.y - b.y) > AXIS_TOLERANCE) return null;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Classify a rectangle: thin → line, big enough → box, else null. */
export function rectangleToRule(
  r: { x: number; y: number; w: number; h: number },
  pageW: number,
  pageH: number,
): RuleDraft | null {
  if (r.h <= MAX_LINE_THICKNESS && r.w >= MIN_LINE_LENGTH) return { box: r, orientation: "horizontal" };
  if (r.w <= MAX_LINE_THICKNESS && r.h >= MIN_LINE_LENGTH) return { box: r, orientation: "vertical" };
  if (r.w < MIN_BOX_SIDE || r.h < MIN_BOX_SIDE) return null;
  if (r.w > PAGE_SIZED * pageW && r.h > PAGE_SIZED * pageH) return null;
  return { box: r, orientation: "box" };
}

/** Turn each straight segment of a stroked path into a line rule when it is axis-aligned and long. */
function segmentsToRules(sub: Subpath, thickness: number): RuleDraft[] {
  const rules: RuleDraft[] = [];
  for (let i = 0; i + 1 < sub.points.length; i++) {
    const a = sub.points[i];
    const b = sub.points[i + 1];
    if (Math.abs(a.y - b.y) < AXIS_TOLERANCE && Math.abs(a.x - b.x) >= MIN_LINE_LENGTH) {
      rules.push({ box: { x: Math.min(a.x, b.x), y: a.y - thickness / 2, w: Math.abs(a.x - b.x), h: thickness }, orientation: "horizontal" });
    } else if (Math.abs(a.x - b.x) < AXIS_TOLERANCE && Math.abs(a.y - b.y) >= MIN_LINE_LENGTH) {
      rules.push({ box: { x: a.x - thickness / 2, y: Math.min(a.y, b.y), w: thickness, h: Math.abs(a.y - b.y) }, orientation: "vertical" });
    }
  }
  return rules;
}

/** Rules produced by one painted path. */
function pathToRules(subpaths: Subpath[], drawOp: number, lineWidth: number, pageW: number, pageH: number): RuleDraft[] {
  const stroked = STROKE_OPS.includes(drawOp);
  const filled = FILL_OPS.includes(drawOp);
  if (!stroked && !filled) return []; // clip path / endPath: draws nothing
  const rules: RuleDraft[] = [];
  for (const sub of subpaths) {
    const rect = asRectangle(sub);
    if (rect) {
      const rule = rectangleToRule(rect, pageW, pageH);
      if (rule) rules.push(rule);
    } else if (stroked) {
      rules.push(...segmentsToRules(sub, lineWidth));
    }
  }
  return rules;
}

// ---- walking the operator list --------------------------------------------------------

interface GState {
  ctm: Matrix;
  lineWidth: number;
}

/** Scale factor of a matrix (used to convert line width to page points). */
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** Walk all drawing instructions and return rule drafts in PDF space (y up). */
async function collectRules(page: PDFPageProxy, pageW: number, pageH: number): Promise<RuleDraft[]> {
  const list = await page.getOperatorList();
  const stack: GState[] = [];
  let state: GState = { ctm: IDENTITY, lineWidth: 1 };
  const rules: RuleDraft[] = [];

  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i];
    const args = list.argsArray[i];
    if (op === OPS.save) stack.push({ ...state });
    else if (op === OPS.restore) state = stack.pop() ?? state;
    else if (op === OPS.transform) state = { ...state, ctm: multiply(args as Matrix, state.ctm) };
    else if (op === OPS.setLineWidth) state = { ...state, lineWidth: args[0] };
    else if (op === OPS.paintFormXObjectBegin) {
      stack.push({ ...state });
      if (args?.[0]) state = { ...state, ctm: multiply(args[0] as Matrix, state.ctm) };
    } else if (op === OPS.paintFormXObjectEnd) state = stack.pop() ?? state;
    else if (op === OPS.constructPath) {
      const [drawOp, [data]] = args as [number, [ArrayLike<number>]];
      const subpaths = decodePath(data, state.ctm);
      rules.push(...pathToRules(subpaths, drawOp, state.lineWidth * scaleOf(state.ctm), pageW, pageH));
    }
  }
  return rules;
}

// ---- cleanup --------------------------------------------------------------------------

/** True if both rules have the same orientation and (almost) the same edges. */
function isDuplicate(a: RuleDraft, b: RuleDraft): boolean {
  const t = DEDUPE_TOLERANCE;
  return (
    a.orientation === b.orientation &&
    Math.abs(a.box.x - b.box.x) <= t &&
    Math.abs(a.box.y - b.box.y) <= t &&
    Math.abs(a.box.w - b.box.w) <= t &&
    Math.abs(a.box.h - b.box.h) <= t
  );
}

/** Remove near-identical rules (PDFs often draw the same line twice, e.g. fill + stroke). */
export function dedupeRules(rules: RuleDraft[]): RuleDraft[] {
  const kept: RuleDraft[] = [];
  for (const rule of rules) if (!kept.some((k) => isDuplicate(k, rule))) kept.push(rule);
  return kept;
}

/**
 * Find all drawn lines and boxes on a page.
 * Example: a field underline 241pt long → { orientation: "horizontal", box: {x, y, w: 241, h: 0.5} }.
 */
export async function getRules(page: PDFPageProxy, pageNumber: number): Promise<Rule[]> {
  const [left, bottom, right, top] = page.view;
  const raw = await collectRules(page, right - left, top - bottom);
  // Convert from PDF space (y up) to top-left origin: the box's top edge is (top - (y + h)).
  const flipped = raw.map((r) => ({
    ...r,
    box: { x: r.box.x - left, y: top - (r.box.y + r.box.h), w: r.box.w, h: r.box.h },
  }));
  const sorted = dedupeRules(flipped).sort((p, q) =>
    Math.abs(p.box.y - q.box.y) > 1 ? p.box.y - q.box.y : p.box.x - q.box.x,
  );
  return sorted.map((r, i) => ({ id: `p${pageNumber}.r${i + 1}`, page: pageNumber, ...r }));
}
