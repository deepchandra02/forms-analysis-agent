/**
 * grounding/lookup.ts — fast "id → thing" access for ONE page of a PdfDoc.
 *
 * WHAT:   Builds Maps of spans, widgets, rules and options so callers never scan arrays.
 * INPUT:  a PdfDoc / PdfPage
 * OUTPUT: PageIndex
 * USED BY: src/grounding/validate.ts, src/grounding/resolve.ts
 */
import type { PdfDoc, PdfPage, Span, Widget, WidgetOption, Rule } from "../pdf/types.js";

export interface PageIndex {
  page: PdfPage;
  spans: Map<string, Span>;
  widgets: Map<string, Widget>;
  rules: Map<string, Rule>;
  /** option id → the option and the widget it belongs to */
  options: Map<string, { option: WidgetOption; widget: Widget }>;
}

/** Find a page by its 1-based number (undefined if out of range). */
export function findPage(doc: PdfDoc, pageNumber: number): PdfPage | undefined {
  return doc.pages.find((p) => p.page === pageNumber);
}

/** Build lookup maps for one page. */
export function indexPage(page: PdfPage): PageIndex {
  const options = new Map<string, { option: WidgetOption; widget: Widget }>();
  for (const widget of page.widgets) {
    for (const option of widget.options) options.set(option.id, { option, widget });
  }
  return {
    page,
    spans: new Map(page.spans.map((s) => [s.id, s])),
    widgets: new Map(page.widgets.map((w) => [w.id, w])),
    rules: new Map(page.rules.map((r) => [r.id, r])),
    options,
  };
}
