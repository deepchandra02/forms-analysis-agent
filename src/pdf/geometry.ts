/**
 * pdf/geometry.ts — pure helpers for "what is near what" on a page.
 *
 * WHAT:   Box distance, direction of one box relative to another, a nearby-element search
 *         (the basis of a "find_nearby" tool for the model) and an id → object lookup.
 *         No pdf.js, no I/O: only numbers in, numbers out.
 * INPUT:  PdfDoc / PdfPage / Box (see types.ts)
 * OUTPUT: distances, directions, lists of neighbours, looked-up spans/widgets/rules
 * USED BY: src/grounding/*, src/agents/input-extraction/tools.ts, tests
 */
import type { Box, PdfDoc, PdfPage, Rule, Span, Widget, WidgetOption } from "./types.js";

export type Direction = "above" | "below" | "left" | "right";

export interface Nearby {
  id: string;
  type: "span" | "widget" | "rule";
  text?: string;
  direction: Direction;
  distance: number;
}

/**
 * Shortest gap between the edges of two boxes in points (0 if they touch or overlap).
 * Example: boxes 10pt apart horizontally on the same row → 10.
 */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/**
 * Where is `b` relative to `a`? Compares the empty gap between the boxes in each axis:
 * a label that overlaps the field horizontally and sits lower is "below", even if its
 * centre is far to the left of a wide field. Overlapping boxes fall back to centre offsets.
 * Example: directionOf(field, labelPrintedUnderIt) → "below".
 */
export function directionOf(a: Box, b: Box): Direction {
  const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const horizontal = gapX === 0 && gapY === 0 ? Math.abs(dx) > Math.abs(dy) : gapX > gapY;
  if (horizontal) return dx < 0 ? "left" : "right";
  return dy < 0 ? "above" : "below";
}

/** Find the box of any id on a page (span, widget, option → its widget, rule). */
function boxOfId(page: PdfPage, id: string): Box | null {
  const hit = getById({ pages: [page] } as PdfDoc, id);
  if (!hit) return null;
  if ("kind" in hit && "box" in hit) return hit.box; // widget
  if ("box" in hit) return hit.box; // span or rule
  return optionOwnerBox(page, id);
}

/** An option has no box of its own: use its widget's box. */
function optionOwnerBox(page: PdfPage, optionId: string): Box | null {
  const widget = page.widgets.find((w) => optionId.startsWith(w.id + "."));
  return widget ? widget.box : null;
}

/** All elements of a page as a flat list (spans, widgets, rules). */
function allElements(page: PdfPage): { id: string; type: Nearby["type"]; text?: string; box: Box }[] {
  return [
    ...page.spans.map((s) => ({ id: s.id, type: "span" as const, text: s.text, box: s.box })),
    ...page.widgets.map((w) => ({ id: w.id, type: "widget" as const, text: w.value ?? undefined, box: w.box })),
    ...page.rules.map((r) => ({ id: r.id, type: "rule" as const, box: r.box })),
  ];
}

/**
 * List elements near `id` (excluding itself), nearest first.
 * Example: findNearby(page, "p1.w4", { direction: "above", limit: 3 }) → the 3 closest
 * things above that field, typically its label.
 */
export function findNearby(
  page: PdfPage,
  id: string,
  opts: { direction?: Direction | "any"; limit?: number } = {},
): Nearby[] {
  const origin = boxOfId(page, id);
  if (!origin) return [];
  const wanted = opts.direction ?? "any";
  const result: Nearby[] = [];
  for (const el of allElements(page)) {
    if (el.id === id) continue;
    const direction = directionOf(origin, el.box);
    if (wanted !== "any" && direction !== wanted) continue;
    const item: Nearby = { id: el.id, type: el.type, direction, distance: Math.round(boxDistance(origin, el.box) * 10) / 10 };
    if (el.text !== undefined) item.text = el.text;
    result.push(item);
  }
  result.sort((p, q) => p.distance - q.distance);
  return result.slice(0, opts.limit ?? 10);
}

/**
 * Look up anything by id: "p1.s14" span, "p1.w3" widget, "p1.w3.o0" option, "p1.r5" rule.
 * Returns undefined if the id does not exist.
 */
export function getById(doc: PdfDoc, id: string): Span | Widget | WidgetOption | Rule | undefined {
  for (const page of doc.pages) {
    const found =
      page.spans.find((s) => s.id === id) ??
      page.widgets.find((w) => w.id === id) ??
      page.widgets.flatMap((w) => w.options).find((o) => o.id === id) ??
      page.rules.find((r) => r.id === id);
    if (found) return found;
  }
  return undefined;
}
