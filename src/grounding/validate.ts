/**
 * grounding/validate.ts — rigorous checks of a PageDraft against the PdfDoc.
 *
 * WHAT:   Decides whether the model's draft is trustworthy. The model only cites IDs, so we
 *         can check mechanically: do the IDs exist, is every span on the page accounted
 *         for, does each field match its widget, ...
 *         ERRORS block acceptance (the agent must fix them). WARNINGS are for a human:
 *         they flag interpretive choices that no script can verify.
 * INPUT:  PdfDoc + draft (typed `unknown`, because schema errors must be caught too)
 * OUTPUT: PageReport { page, errors, warnings }; formatReport() renders it as compact text
 * USED BY: the agent's check_draft tool, the pipeline gate before resolveForm, tests
 *
 * Every message names the path and the IDs and says what to do, so the LLM can act on it.
 */
import type { PdfDoc, Widget, WidgetKind, Box } from "../pdf/types.js";
import { PageDraftSchema, type FieldDraft, type FieldType, type ItemDraft, type PageDraft } from "../schema/draft.js";
import { collectRefs, parseId, safeParseTextRef, type RefUse } from "../schema/refs.js";
import { findPage, indexPage, type PageIndex } from "./lookup.js";
import { joinSpans } from "./normalize.js";
import type { Issue, IssueCode, PageReport } from "./report.js";

/** W_LABEL_FAR_FROM_INPUT fires when label box and input box are further apart than this (points). */
export const MAX_LABEL_INPUT_DISTANCE_PT = 150;

/** formatReport lists at most this many issues per section, then "... and N more". */
export const MAX_LISTED_ISSUES = 30;

/** Which field_types a widget kind may carry. Pushbuttons carry none. */
const FIELD_TYPES_FOR_WIDGET: Record<WidgetKind, FieldType[]> = {
  text: ["text", "multiline_text", "date", "number"],
  checkbox: ["checkbox"],
  radio: ["radio"],
  dropdown: ["dropdown"],
  listbox: ["dropdown"],
  signature: ["signature"],
  pushbutton: [],
};

/** Where the checks collect their findings. */
interface Sink {
  errors: Issue[];
  warnings: Issue[];
}

function err(sink: Sink, code: IssueCode, path: string, message: string, refs?: string[]): void {
  sink.errors.push(refs ? { code, path, message, refs } : { code, path, message });
}

function warn(sink: Sink, code: IssueCode, path: string, message: string, refs?: string[]): void {
  sink.warnings.push(refs ? { code, path, message, refs } : { code, path, message });
}

/** Remove issues that repeat the same code + path + message. */
function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.path}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// E_KIND_SHAPE — "flat item with nullable slots" needs a check that the right slot is filled.
// WHY: the Azure-friendly draft schema cannot express "kind=list implies list_items", so we do.
// ---------------------------------------------------------------------------

const SLOT_FOR_KIND = {
  paragraph: "text",
  note: "text",
  list: "list_items",
  table: "table_rows",
  field: "field",
} as const;
const ALL_SLOTS = ["text", "list_items", "table_rows", "field"] as const;

function checkKindShape(item: ItemDraft, path: string, sink: Sink): void {
  const wanted = SLOT_FOR_KIND[item.kind];
  const value = item[wanted];
  if (value === null) {
    err(sink, "E_KIND_SHAPE", `${path}.${wanted}`, `Item of kind "${item.kind}" needs \`${wanted}\` to be filled (it is null).`);
  } else if (Array.isArray(value) && value.length === 0) {
    err(sink, "E_KIND_SHAPE", `${path}.${wanted}`, `Item of kind "${item.kind}" needs a non-empty \`${wanted}\`.`);
  }
  for (const slot of ALL_SLOTS) {
    if (slot !== wanted && item[slot] !== null) {
      err(sink, "E_KIND_SHAPE", `${path}.${slot}`, `Item of kind "${item.kind}" must have \`${slot}\` = null (only \`${wanted}\` is used).`);
    }
  }
}

// ---------------------------------------------------------------------------
// Ref checks: E_BAD_REF, E_WRONG_REF_TYPE, E_WRONG_PAGE_REF, E_UNKNOWN_REF, E_DUPLICATE_REF
// ---------------------------------------------------------------------------

/** State shared by the ref checks. */
interface RefCtx {
  index: PageIndex;
  pageNumber: number;
  sink: Sink;
  /** span id → path where it was first cited (for duplicate detection + coverage) */
  cited: Map<string, string>;
}

/** Check one SPAN id (from a TextRef or an option entry) and record it as cited. */
function checkSpanId(ctx: RefCtx, path: string, id: string, allowRepeat = false): void {
  const parsed = parseId(id);
  if (parsed.page !== ctx.pageNumber) {
    return err(ctx.sink, "E_WRONG_PAGE_REF", path, `${id} is on page ${parsed.page}, but this draft is for page ${ctx.pageNumber}.`, [id]);
  }
  if (!ctx.index.spans.has(id)) {
    return err(ctx.sink, "E_UNKNOWN_REF", path, `Span ${id} does not exist on page ${ctx.pageNumber}.`, [id]);
  }
  const first = ctx.cited.get(id);
  if (first !== undefined) {
    // required_evidence may re-cite the label span that carries "(mandatory field)".
    if (allowRepeat) return;
    // A row with several input boxes (e.g. "Banking relationship" has two widgets) is modelled as
    // several fields that share ONE printed label. Only label-to-label repeats are tolerated.
    if (path.endsWith(".field.label") && first.endsWith(".field.label")) return;
    // WHY: citing a span twice usually means text is duplicated in the output.
    return err(ctx.sink, "E_DUPLICATE_REF", path, `Span ${id} ('${ctx.index.spans.get(id)!.text}') is already used at ${first}. Use each span once.`, [id]);
  }
  ctx.cited.set(id, path);
}

/** A TextRef ("text" or "ignored" use): every id must be a span. */
function checkTextRef(ctx: RefCtx, use: RefUse): void {
  const r = safeParseTextRef(use.raw);
  if (!r.ok) return err(ctx.sink, "E_BAD_REF", use.path, `${r.error} Fix the ref syntax: "p1.s3", "p1.s3-p1.s7" or "p1.s3,p1.s9".`);
  for (const id of r.ids) checkSpanId(ctx, use.path, id, use.kind === "evidence");
}

/** Parse a single-id slot (input / option). Reports E_BAD_REF and returns null on failure. */
function parseSingle(ctx: RefCtx, use: RefUse) {
  try {
    return parseId(use.raw);
  } catch {
    err(ctx.sink, "E_BAD_REF", use.path, `"${use.raw}" is not a valid single ID (expected p1.s3, p1.w3, p1.w3.o0 or p1.r5).`);
    return null;
  }
}

/** field.input: a widget or rule id. A span here is a type mismatch; other things a wrong ref type. */
function checkInputRef(ctx: RefCtx, use: RefUse): void {
  const id = parseSingle(ctx, use);
  if (!id) return;
  if (id.type === "span") {
    return err(ctx.sink, "E_WIDGET_TYPE_MISMATCH", use.path, `input ${use.raw} is a span (text). input must be a widget (p1.wN) or rule (p1.rN) id, or null.`, [use.raw]);
  }
  if (id.type === "option") {
    return err(ctx.sink, "E_WRONG_REF_TYPE", use.path, `input ${use.raw} is an option id. Use the widget id instead (${use.raw.replace(/\.o\d+$/, "")}).`, [use.raw]);
  }
  if (id.page !== ctx.pageNumber) {
    return err(ctx.sink, "E_WRONG_PAGE_REF", use.path, `${use.raw} is on page ${id.page}, but this draft is for page ${ctx.pageNumber}.`, [use.raw]);
  }
  const exists = id.type === "widget" ? ctx.index.widgets.has(use.raw) : ctx.index.rules.has(use.raw);
  if (!exists) err(ctx.sink, "E_UNKNOWN_REF", use.path, `${id.type === "widget" ? "Widget" : "Rule"} ${use.raw} does not exist on page ${ctx.pageNumber}.`, [use.raw]);
}

/** field.options[k]: an option id or a span id (printed option). Widgets/rules are wrong here. */
function checkOptionRef(ctx: RefCtx, use: RefUse): void {
  const id = parseSingle(ctx, use);
  if (!id) return;
  if (id.type === "span") return checkSpanId(ctx, use.path, use.raw);
  if (id.type === "widget" || id.type === "rule") {
    return err(ctx.sink, "E_WRONG_REF_TYPE", use.path, `options entry ${use.raw} is a ${id.type} id. Options must be option ids (p1.w3.o0) or span ids of printed options.`, [use.raw]);
  }
  if (id.page !== ctx.pageNumber) {
    return err(ctx.sink, "E_WRONG_PAGE_REF", use.path, `${use.raw} is on page ${id.page}, but this draft is for page ${ctx.pageNumber}.`, [use.raw]);
  }
  if (!ctx.index.options.has(use.raw)) err(ctx.sink, "E_UNKNOWN_REF", use.path, `Option ${use.raw} does not exist on page ${ctx.pageNumber}.`, [use.raw]);
}

/**
 * Run all ref checks. Refs inside a TextRef that point at non-spans are reported as
 * E_WRONG_REF_TYPE here (before span checks), e.g. a widget id used as a label.
 */
function checkAllRefs(ctx: RefCtx, uses: RefUse[]): void {
  for (const use of uses) {
    if (use.kind === "input") checkInputRef(ctx, use);
    else if (use.kind === "option") checkOptionRef(ctx, use);
    else checkTextOrIgnored(ctx, use);
  }
}

/** Text/ignored refs: report wrong types for non-span ids, then do the span checks. */
function checkTextOrIgnored(ctx: RefCtx, use: RefUse): void {
  const wrong = firstNonSpanId(use.raw);
  if (wrong) {
    return err(ctx.sink, "E_WRONG_REF_TYPE", use.path, `${wrong.id} is a ${wrong.type} id, but this slot takes SPAN ids (p1.sN) only.`, [wrong.id]);
  }
  checkTextRef(ctx, use);
}

/** If a TextRef contains a valid widget/option/rule id, return it (so we can give a precise message). */
function firstNonSpanId(raw: string): { id: string; type: string } | null {
  for (const part of raw.split(",")) {
    for (const piece of part.split("-")) {
      try {
        const id = parseId(piece);
        if (id.type !== "span") return { id: piece.trim(), type: id.type };
      } catch {
        // not an id at all: E_BAD_REF is reported by checkTextRef
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Coverage and widget usage
// ---------------------------------------------------------------------------

/**
 * E_UNACCOUNTED_SPAN: every span on the page must be cited OR ignored.
 * WHY: this is what stops the model from silently skipping content.
 * (Pre-filled widget value spans are spans too: cite them, e.g. as a hint, or ignore them.)
 */
function checkCoverage(ctx: RefCtx, sink: Sink): void {
  for (const span of ctx.index.page.spans) {
    if (ctx.cited.has(span.id)) continue;
    err(sink, "E_UNACCOUNTED_SPAN", "ignored", `Span ${span.id} ('${span.text}') is not used. Cite it or add it to \`ignored\` with a reason.`, [span.id]);
  }
}

/**
 * E_UNUSED_WIDGET: every interactive widget must be the input of some field.
 * Exceptions: pushbuttons (Print/Reset are not data entry), and widgets whose pre-filled
 * value span is cited (the content is accounted for, e.g. as a note).
 */
function checkWidgetUsage(ctx: RefCtx, usedInputs: Set<string>, sink: Sink): void {
  for (const w of ctx.index.page.widgets) {
    if (w.kind === "pushbutton" || usedInputs.has(w.id)) continue;
    if (w.valueSpanId !== null && ctx.cited.has(w.valueSpanId)) continue;
    err(sink, "E_UNUSED_WIDGET", `widgets[${w.id}]`, `Widget ${w.id} (${w.kind}) is not the input of any field. Add a field with input "${w.id}".`, [w.id]);
  }
}

// ---------------------------------------------------------------------------
// Field-level checks
// ---------------------------------------------------------------------------

/** Distance between two boxes in points (0 if they touch or overlap). */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Smallest box containing all boxes (undefined for none). */
function unionBox(boxes: Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The spans a TextRef covers, silently skipping anything unparseable/unknown (errors are reported elsewhere). */
function spansOfRef(index: PageIndex, raw: string) {
  const r = safeParseTextRef(raw);
  if (!r.ok) return [];
  return r.ids.flatMap((id) => {
    const s = index.spans.get(id);
    return s ? [s] : [];
  });
}

/** E_WIDGET_TYPE_MISMATCH: field_type must be one the widget can really be. */
function checkTypeVsWidget(f: FieldDraft, w: Widget, path: string, sink: Sink): void {
  const allowed = FIELD_TYPES_FOR_WIDGET[w.kind];
  if (allowed.includes(f.field_type)) return;
  const hint = allowed.length ? `Use ${allowed.map((t) => `"${t}"`).join(" or ")}.` : "A pushbutton is not a data field; do not use it as input.";
  err(sink, "E_WIDGET_TYPE_MISMATCH", `${path}.field_type`, `field_type "${f.field_type}" does not match widget ${w.id}, which is a ${w.kind} widget. ${hint}`, [w.id]);
}

/** Dropdown/listbox widget: options must be exactly the widget's option ids, in order. */
function checkDropdownOptions(f: FieldDraft, w: Widget, path: string, sink: Sink): void {
  const expected = w.options.map((o) => o.id);
  const actual = f.options ?? [];
  if (expected.length === actual.length && expected.every((id, i) => id === actual[i])) return;
  err(sink, "E_OPTIONS_MISMATCH", `${path}.options`, `Options of dropdown ${w.id} must be exactly [${expected.join(", ")}] in this order (got [${actual.join(", ")}]).`, [w.id]);
}

/**
 * Radio/checkbox groups: printed options are span ids. We also accept option ids that belong
 * to the field's own widget (a radio widget can carry its own options).
 */
function checkChoiceOptions(f: FieldDraft, w: Widget | undefined, path: string, sink: Sink): void {
  (f.options ?? []).forEach((o, k) => {
    let type: string;
    try {
      type = parseId(o).type;
    } catch {
      return; // E_BAD_REF already reported
    }
    const ownOption = w !== undefined && w.options.some((x) => x.id === o);
    if (type !== "span" && !ownOption) {
      err(sink, "E_OPTIONS_MISMATCH", `${path}.options[${k}]`, `${f.field_type} option ${o} must be a span id of the printed option text${w ? ` (or an option of ${w.id})` : ""}.`, [o]);
    }
  });
}

/** Cross-check field.options against field_type and the input widget. */
function checkOptions(f: FieldDraft, w: Widget | undefined, path: string, sink: Sink): void {
  const hasOptions = f.options !== null && f.options.length > 0;
  if (f.field_type === "dropdown") {
    if (w && (w.kind === "dropdown" || w.kind === "listbox")) return checkDropdownOptions(f, w, path, sink);
    if (!hasOptions) err(sink, "E_OPTIONS_MISMATCH", `${path}.options`, "A dropdown needs `options` (option ids of its widget, or span ids of the printed choices).");
    return;
  }
  if (f.field_type === "radio" || f.field_type === "checkbox") return checkChoiceOptions(f, w, path, sink);
  // WHY: options on a text/date/... field mean the model misread the field type.
  if (f.options !== null) err(sink, "E_OPTIONS_MISMATCH", `${path}.options`, `Fields of type "${f.field_type}" must have options = null.`);
}

/** W_LABEL_FAR_FROM_INPUT: a far-away label is a sign the label/input pairing may be wrong. */
function checkLabelDistance(index: PageIndex, f: FieldDraft, inputBox: Box, path: string, sink: Sink): void {
  const labelBox = unionBox(spansOfRef(index, f.label).map((s) => s.box));
  if (!labelBox) return;
  const d = boxDistance(labelBox, inputBox);
  if (d > MAX_LABEL_INPUT_DISTANCE_PT) {
    warn(sink, "W_LABEL_FAR_FROM_INPUT", path, `Label ${f.label} is ${Math.round(d)}pt away from input ${f.input}. Check that this label belongs to this input.`, [f.label, f.input ?? ""]);
  }
}

/** All per-field checks. Records the input id in `usedInputs`. */
function checkField(index: PageIndex, f: FieldDraft, path: string, usedInputs: Set<string>, sink: Sink): void {
  const widget = f.input ? index.widgets.get(f.input) : undefined;
  const rule = f.input ? index.rules.get(f.input) : undefined;
  if (f.input) usedInputs.add(f.input);

  if (widget) checkTypeVsWidget(f, widget, path, sink);
  checkOptions(f, widget, path, sink);

  if (f.required && f.required_evidence === null) {
    // WHY: "required" must be proven by printed text, never guessed (e.g. a red asterisk the model "remembers").
    err(sink, "E_REQUIRED_NO_EVIDENCE", `${path}.required_evidence`, "required=true needs `required_evidence` (span(s) that say the field is mandatory). Cite them, or set required=false.");
  }

  if (f.input === null) warn(sink, "W_NO_INPUT", `${path}.input`, `Field has no input (no widget or line). Check that nothing is missing on the page.`);
  if (!widget) warn(sink, "W_TYPE_INFERRED", `${path}.field_type`, `field_type "${f.field_type}" is inferred from the layout; no widget confirms it.`);
  const inputBox = widget?.box ?? rule?.box;
  if (inputBox) checkLabelDistance(index, f, inputBox, path, sink);
}

/** Run the field checks for every field item. */
function checkFields(index: PageIndex, draft: PageDraft, usedInputs: Set<string>, sink: Sink): void {
  draft.sections.forEach((s, si) =>
    s.items.forEach((item, ii) => {
      const path = `sections[${si}].items[${ii}]`;
      checkKindShape(item, path, sink);
      if (item.kind === "field" && item.field) checkField(index, item.field, `${path}.field`, usedInputs, sink);
    }),
  );
}

/** W_NORMALIZED: tell the human when joined text differs from the raw PDF text. */
function checkNormalization(index: PageIndex, uses: RefUse[], sink: Sink): void {
  for (const use of uses) {
    if (use.kind !== "text") continue;
    const spans = spansOfRef(index, use.raw);
    if (spans.length === 0) continue;
    const { text, applied } = joinSpans(spans);
    if (applied.length === 0) continue;
    const before = spans.map((s) => s.text).join(" ");
    warn(sink, "W_NORMALIZED", use.path, `Text normalized (${applied.join(", ")}): '${before}' → '${text}'.`, [use.raw]);
  }
}

/** Turn zod issues into E_SCHEMA errors with a JSON-ish path. */
function schemaErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): Issue[] {
  return error.issues.map((i) => ({
    code: "E_SCHEMA" as const,
    path: i.path.map((p, k) => (typeof p === "number" ? `[${p}]` : k === 0 ? String(p) : `.${String(p)}`)).join("") || "$",
    message: `Schema violation: ${i.message}`,
  }));
}

/**
 * Validate a draft for ONE page. `draft` is `unknown` so schema violations become E_SCHEMA
 * instead of exceptions. If the schema fails, no other check runs (the data may be unusable).
 * Example: validatePage(doc, draft).errors.length === 0 → safe to resolve.
 */
export function validatePage(doc: PdfDoc, draftInput: unknown): PageReport {
  const sink: Sink = { errors: [], warnings: [] };
  const parsed = PageDraftSchema.safeParse(draftInput);
  const pageGuess = parsed.success ? parsed.data.page : typeof (draftInput as { page?: unknown })?.page === "number" ? (draftInput as { page: number }).page : 0;
  if (!parsed.success) {
    sink.errors.push(...schemaErrors(parsed.error));
    return { page: pageGuess, errors: dedupe(sink.errors), warnings: [] };
  }
  const draft = parsed.data;
  const pdfPage = findPage(doc, draft.page);
  if (!pdfPage) {
    err(sink, "E_WRONG_PAGE_REF", "page", `draft.page = ${draft.page} is out of range (the document has ${doc.pageCount} pages).`);
    return { page: draft.page, errors: sink.errors, warnings: [] };
  }

  const index = indexPage(pdfPage);
  const uses = collectRefs(draft);
  const ctx: RefCtx = { index, pageNumber: draft.page, sink, cited: new Map() };
  const usedInputs = new Set<string>();

  checkAllRefs(ctx, uses);
  checkFields(index, draft, usedInputs, sink);
  checkCoverage(ctx, sink);
  checkWidgetUsage(ctx, usedInputs, sink);
  checkNormalization(index, uses, sink);

  return { page: draft.page, errors: dedupe(sink.errors), warnings: dedupe(sink.warnings) };
}

function formatIssues(title: string, issues: Issue[]): string[] {
  if (issues.length === 0) return [];
  const lines = [`${title} (${issues.length}):`];
  for (const i of issues.slice(0, MAX_LISTED_ISSUES)) lines.push(`- [${i.code}] ${i.path}: ${i.message}`);
  if (issues.length > MAX_LISTED_ISSUES) lines.push(`- ... and ${issues.length - MAX_LISTED_ISSUES} more`);
  return lines;
}

/**
 * Compact text for the agent's tool output (long lists are capped).
 * Example: "Page 1: 1 error, 0 warnings\nERRORS (1):\n- [E_UNACCOUNTED_SPAN] ignored: ..."
 */
export function formatReport(report: PageReport): string {
  const { errors, warnings } = report;
  if (errors.length === 0 && warnings.length === 0) return `Page ${report.page}: OK (no errors, no warnings)`;
  const head = `Page ${report.page}: ${errors.length} error(s), ${warnings.length} warning(s)${errors.length === 0 ? " - draft is acceptable" : " - fix the errors"}`;
  return [head, ...formatIssues("ERRORS", errors), ...formatIssues("WARNINGS", warnings)].join("\n");
}
