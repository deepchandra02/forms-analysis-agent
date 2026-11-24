/**
 * agents/input-extraction/format.ts — compact text lines for tool outputs.
 *
 * WHAT:   Turns spans, widgets and rules into ONE short line each. Token-cheap on purpose:
 *         a page has 50-200 items and the model reads all of them.
 * INPUT:  Span / Widget / Rule / PdfPage (see src/pdf/types.ts)
 * OUTPUT: strings, e.g. `p1.s29 | Last name | x=49.6 y=524.2 w=34.6 h=8 | 8pt`
 * USED BY: src/agents/input-extraction/tools.ts
 *
 * (src/cli/dump-page.ts has its own, slightly different debug format; it is left alone.)
 */
import type { Box, PdfPage, Rule, Span, Widget } from "../../pdf/types.js";

/** "x=49.6 y=524.2 w=34.6 h=8" */
export function formatBox(b: Box): string {
  return `x=${b.x} y=${b.y} w=${b.w} h=${b.h}`;
}

/**
 * One span per line: id | text | box | size | flags.
 * Example: `p1.s27 | Details of the deceased pension holder | x=49.6 y=492 w=146.2 h=8 | 8pt | bold`
 */
export function formatSpan(s: Span): string {
  const parts = [s.id, s.text, formatBox(s.box), `${s.fontSize}pt`];
  if (s.bold) parts.push("bold");
  if (s.source === "widget") parts.push(`value-of=${s.widgetId}`);
  return parts.join(" | ");
}

/**
 * One widget per line: id | kind | box | extras (multiline, options, pre-filled value).
 * Example: `p1.w11 | dropdown | x=49.3 y=617.2 w=241.4 h=17.4 | options: p1.w11.o1=Single; p1.w11.o2=Married`
 */
export function formatWidget(w: Widget): string {
  const parts = [w.id, w.kind, formatBox(w.box)];
  if (w.multiline) parts.push("multiline");
  if (w.options.length > 0) parts.push(`options: ${w.options.map((o) => `${o.id}=${o.text}`).join("; ")}`);
  if (w.value !== null) parts.push(`value="${w.value}" (span ${w.valueSpanId})`);
  return parts.join(" | ");
}

/** One rule per line. Example: `p1.r5 | horizontal | x=49.3 y=521.3 w=241.3 h=0.3` */
export function formatRule(r: Rule): string {
  return [r.id, r.orientation, formatBox(r.box)].join(" | ");
}

/** Spans of a page, one per line, with a header line. */
export function formatSpans(page: PdfPage): string {
  return [`SPANS (${page.spans.length}) id | text | box | size | flags`, ...page.spans.map(formatSpan)].join("\n");
}

/** Widgets of a page, one per line, with a header line. */
export function formatWidgets(page: PdfPage): string {
  return [`WIDGETS (${page.widgets.length}) id | kind | box | extras`, ...page.widgets.map(formatWidget)].join("\n");
}

/** Rules of a page, one per line, with a header line. */
export function formatRules(page: PdfPage): string {
  return [`RULES (${page.rules.length}) id | orientation | box`, ...page.rules.map(formatRule)].join("\n");
}
