/**
 * pdf/widgets.ts — read the fill-in fields (AcroForm widgets) of a page.
 *
 * WHAT:   Converts pdf.js annotations of subtype "Widget" into our Widget type:
 *         translates the field type (Tx/Btn/Ch/Sig) to a plain kind, keeps only what is
 *         visible (display text of options, visible value) and drops hidden fields.
 *         Internal field names are deliberately NOT copied.
 *         A pre-filled text value also becomes a "widget" span draft so the model can
 *         read it (e.g. "Complete and print out this page for each beneficiary.").
 * INPUT:  a pdf.js page, the page number
 * OUTPUT: { widgets: Widget[], valueDrafts: SpanDraft[] }
 * USED BY: src/pdf/extract.ts
 *
 * MERGING INTO READING ORDER: value spans are returned as drafts; extract.ts adds them to
 *         the text drafts and calls numberSpans once, so everything is sorted by position
 *         and the widget value lands exactly where it is drawn.
 */
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Box, Widget, WidgetKind, WidgetOption } from "./types.js";
import type { SpanDraft } from "./lines.js";

/** The parts of a pdf.js widget annotation we use. */
interface RawWidget {
  subtype: string;
  fieldType?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  combo?: boolean;
  multiLine?: boolean;
  hidden?: boolean;
  annotationFlags?: number;
  fieldValue?: string | string[] | null;
  options?: { exportValue: string; displayValue: string }[];
  rect: number[];
}

/** PDF annotation flag bits: Hidden = 2, NoView = 32 (neither is shown on screen). */
const HIDDEN_FLAG = 2;
const NO_VIEW_FLAG = 32;

/** Height used for the value span's text when the field is taller than one line. */
const FALLBACK_FONT_SIZE = 8;

/** True if the user can see this widget. */
function isVisible(w: RawWidget): boolean {
  const flags = w.annotationFlags ?? 0;
  return !w.hidden && (flags & (HIDDEN_FLAG | NO_VIEW_FLAG)) === 0;
}

/** Translate the PDF field type into our WidgetKind, or null if unknown. */
export function widgetKind(w: RawWidget): WidgetKind | null {
  switch (w.fieldType) {
    case "Tx":
      return "text";
    case "Btn":
      if (w.pushButton) return "pushbutton";
      if (w.radioButton) return "radio";
      return "checkbox";
    case "Ch":
      return w.combo ? "dropdown" : "listbox";
    case "Sig":
      return "signature";
    default:
      return null;
  }
}

/** pdf.js rect [x1, y1, x2, y2] in PDF space → top-left Box. */
function rectToBox(rect: number[], view: number[]): Box {
  const [left, , , top] = view;
  const x = Math.min(rect[0], rect[2]) - left;
  const yTop = top - Math.max(rect[1], rect[3]);
  return { x, y: yTop, w: Math.abs(rect[2] - rect[0]), h: Math.abs(rect[3] - rect[1]) };
}

/** The field's visible value as one string, or null when empty. */
function visibleValue(w: RawWidget): string | null {
  const raw = Array.isArray(w.fieldValue) ? w.fieldValue.join(", ") : w.fieldValue;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  // Checkbox/radio store "Off"/"Yes" etc.; that is state, not visible text.
  return w.fieldType === "Tx" ? raw : null;
}

/** Options of a dropdown/listbox: display text, original PDF index kept in the id.
 *  Blank entries (a lone " " is common as "nothing selected") are skipped but keep their index. */
function readOptions(w: RawWidget, widgetId: string): WidgetOption[] {
  const options: WidgetOption[] = [];
  (w.options ?? []).forEach((opt, k) => {
    if (opt.displayValue.trim() === "") return;
    options.push({ id: `${widgetId}.o${k}`, text: opt.displayValue });
  });
  return options;
}

/** Top-to-bottom, then left-to-right (rows within 3pt count as the same row). */
function byPosition(p: { box: Box }, q: { box: Box }): number {
  return Math.abs(p.box.y - q.box.y) > 3 ? p.box.y - q.box.y : p.box.x - q.box.x;
}

/** Build the span draft for a pre-filled text value. */
function valueDraft(value: string, box: Box, widgetId: string): SpanDraft {
  // Use the first line of the field as the text line: font size ≈ 80% of a one-line field height.
  const fontSize = Math.min(FALLBACK_FONT_SIZE, box.h);
  return {
    text: value,
    box,
    fontSize,
    bold: false,
    source: "widget",
    widgetId,
    baseline: box.y + fontSize,
    vertical: false,
  };
}

/**
 * Read all visible widgets on a page.
 * Example: event-of-death page 1 → 12 widgets (11 text fields and the Marital status dropdown).
 * Value spans get no id here; extract.ts numbers them with the text spans, then fills
 * `valueSpanId` via `linkValueSpans`.
 */
export async function getWidgets(
  page: PDFPageProxy,
  pageNumber: number,
): Promise<{ widgets: Widget[]; valueDrafts: SpanDraft[] }> {
  const annotations = (await page.getAnnotations()) as unknown as RawWidget[];
  const found: { widget: Widget; raw: RawWidget }[] = [];
  for (const raw of annotations) {
    if (raw.subtype !== "Widget" || !isVisible(raw)) continue;
    const kind = widgetKind(raw);
    if (!kind) continue;
    const box = rectToBox(raw.rect, page.view);
    found.push({
      raw,
      widget: {
        id: "",
        page: pageNumber,
        kind,
        box,
        multiline: raw.multiLine === true,
        options: [],
        value: visibleValue(raw),
        valueSpanId: null,
      },
    });
  }
  found.sort((p, q) => byPosition(p.widget, q.widget));

  const valueDrafts: SpanDraft[] = [];
  found.forEach(({ widget, raw }, i) => {
    widget.id = `p${pageNumber}.w${i + 1}`;
    widget.options = readOptions(raw, widget.id);
    if (widget.value !== null) valueDrafts.push(valueDraft(widget.value, widget.box, widget.id));
  });
  return { widgets: found.map((f) => f.widget), valueDrafts };
}

/**
 * After spans are numbered, set `valueSpanId` on each widget that has a value span.
 * Example: widget p3.w3 + span {source:"widget", widgetId:"p3.w3", id:"p3.s7"} → valueSpanId "p3.s7".
 */
export function linkValueSpans(widgets: Widget[], spans: { id: string; widgetId: string | null }[]): void {
  for (const span of spans) {
    const widget = widgets.find((w) => w.id === span.widgetId);
    if (widget) widget.valueSpanId = span.id;
  }
}
