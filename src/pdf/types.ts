/**
 * pdf/types.ts — the shape of a PDF after our "reader" script has processed it.
 *
 * WHAT:   Plain data types only, with no logic. Every other module (grounding, tools,
 *         agent) depends on these types, so they are the contract between the
 *         deterministic PDF layer and everything else.
 * INPUT:  none (types only)
 * OUTPUT: PdfDoc → PdfPage → Span / Widget / Rule
 * USED BY: src/pdf/extract.ts (produces a PdfDoc), src/grounding/* and
 *          src/agents/input-extraction/tools.ts (consume a PdfDoc)
 *
 * ID FORMAT (stable, human-readable, used by the model to "point" at things):
 *   span    p{page}.s{n}        e.g. "p1.s14"     (n = reading order, starting at 1)
 *   widget  p{page}.w{n}        e.g. "p1.w3"      (n = top-to-bottom, left-to-right)
 *   option  p{page}.w{n}.o{k}   e.g. "p1.w3.o0"   (k = order stored in the PDF, starting at 0)
 *   rule    p{page}.r{n}        e.g. "p1.r5"      (n = top-to-bottom, left-to-right)
 *
 * COORDINATES: PDF points (1/72 inch), origin at the TOP-LEFT of the page,
 * y grows downwards (like a screen, unlike raw PDF space).
 */

/** An axis-aligned rectangle in points, top-left origin. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A span is a run of text on a single visual line with one style.
 * Example: the label "Last name" on page 1 is one span; "First name(s)" next to it
 * (separated by a big gap) is another.
 */
export interface Span {
  id: string; // "p1.s14"
  page: number; // 1-based
  text: string; // exactly as in the PDF text layer (no normalization)
  box: Box;
  fontSize: number; // rounded to 0.1pt
  bold: boolean;
  /** Visual line number on the page (0-based). Spans on the same line share it. */
  line: number;
  /**
   * "text"   = from the page's text layer
   * "widget" = the visible value of a form field (e.g. pre-filled instructions)
   */
  source: "text" | "widget";
  /** For source === "widget": the widget this value belongs to. */
  widgetId: string | null;
}

/** The kind of fill-in element, translated from the PDF's internal field type. */
export type WidgetKind =
  | "text" // PDF /Tx
  | "checkbox" // PDF /Btn (checkbox)
  | "radio" // PDF /Btn (radio)
  | "pushbutton" // PDF /Btn (push button, e.g. "Print")
  | "dropdown" // PDF /Ch (combo box)
  | "listbox" // PDF /Ch (list box)
  | "signature"; // PDF /Sig

/** One selectable option of a dropdown/listbox/radio group. */
export interface WidgetOption {
  id: string; // "p1.w3.o0"
  text: string; // the DISPLAY text (what a person sees), not the export value
}

/**
 * A widget is a fill-in box of an AcroForm (interactive PDF).
 * NOTE: internal field names (e.g. "Nachname", "Text10") are deliberately NOT stored;
 * we only describe what is rendered.
 */
export interface Widget {
  id: string; // "p1.w3"
  page: number;
  kind: WidgetKind;
  box: Box;
  multiline: boolean;
  options: WidgetOption[]; // empty unless dropdown/listbox/radio
  /** Visible value, if the field is pre-filled (null when empty). */
  value: string | null;
  /** If value is non-empty it is also emitted as a span; this links to it. */
  valueSpanId: string | null;
}

/**
 * A rule is a drawn line or thin box from the page's vector graphics.
 * On static (non-AcroForm) PDFs, a horizontal rule near a label usually IS the input box.
 */
export interface Rule {
  id: string; // "p1.r5"
  page: number;
  box: Box; // for a horizontal line, h ≈ line thickness
  orientation: "horizontal" | "vertical" | "box";
}

export interface PdfPage {
  page: number; // 1-based
  width: number;
  height: number;
  spans: Span[]; // in reading order (top-to-bottom, then left-to-right)
  widgets: Widget[];
  rules: Rule[];
}

export interface PdfDoc {
  sourceFile: string; // file name only (no directories)
  pageCount: number;
  isAcroForm: boolean; // true if any page has at least one widget
  pages: PdfPage[];
}
