/**
 * grounding/resolve.ts — replace every ID pointer of a PageDraft with the exact PDF text.
 *
 * WHAT:   PageDraft (IDs) → FormPage (text). Text refs are joined with the narrow rules in
 *         normalize.ts; option IDs become the option's display text; span IDs in options
 *         become that span's text; field.input becomes "widget" | "rule" | "none".
 * INPUT:  PdfDoc + PageDraft (already checked by validatePage; unknown refs throw anyway)
 * OUTPUT: resolvePage → { page: FormPage, notes }, resolveForm → Form
 * USED BY: the pipeline after the agent's draft passed validation; tests
 */
import type { PdfDoc } from "../pdf/types.js";
import type { FieldDraft, ItemDraft, PageDraft, SectionDraft } from "../schema/draft.js";
import type { Form, FormItem, FormPage, FormSection } from "../schema/form.js";
import { parseId, parseTextRef } from "../schema/refs.js";
import { findPage, indexPage, type PageIndex } from "./lookup.js";
import { joinSpans, type NormalizeRule } from "./normalize.js";

/** A text where a normalization rule changed something (for human review). */
export interface ResolveNote {
  path: string;
  rules: NormalizeRule[];
  before: string; // spans joined with single spaces, untouched
  after: string; // final text
}

/**
 * Resolve a TextRef to its joined text. Throws if a span does not exist.
 * Example: resolveTextRef(index, "p1.s3-p1.s4") → { text: "Last name", applied: [] }
 */
export function resolveTextRef(index: PageIndex, ref: string): { text: string; applied: NormalizeRule[]; before: string } {
  const spans = parseTextRef(ref).map((id) => {
    const span = index.spans.get(id);
    if (!span) throw new Error(`Unknown span ${id}`);
    return span;
  });
  const { text, applied } = joinSpans(spans);
  return { text, applied, before: spans.map((s) => s.text).join(" ") };
}

/** Resolver state for one page: the lookup index plus the notes collected so far. */
interface Ctx {
  index: PageIndex;
  notes: ResolveNote[];
}

/** Resolve a text ref and record a note if normalization changed it. */
function text(ctx: Ctx, path: string, ref: string): string {
  const r = resolveTextRef(ctx.index, ref);
  if (r.applied.length > 0) ctx.notes.push({ path, rules: r.applied, before: r.before, after: r.text });
  return r.text;
}

/** One entry of field.options: an option id → its display text, a span id → the span text. */
function resolveOption(ctx: Ctx, path: string, ref: string): string {
  if (parseId(ref).type === "option") {
    const hit = ctx.index.options.get(ref.trim());
    if (!hit) throw new Error(`Unknown option ${ref}`);
    return hit.option.text;
  }
  return text(ctx, path, ref);
}

/** field.input id → "widget" | "rule" | "none". */
function resolveInput(input: string | null): "widget" | "rule" | "none" {
  if (input === null) return "none";
  return parseId(input).type === "rule" ? "rule" : "widget";
}

function resolveField(ctx: Ctx, path: string, f: FieldDraft): FormItem {
  return {
    kind: "field",
    label: text(ctx, `${path}.label`, f.label),
    field_type: f.field_type,
    hints: f.hints.map((h, k) => text(ctx, `${path}.hints[${k}]`, h)),
    options: f.options === null ? null : f.options.map((o, k) => resolveOption(ctx, `${path}.options[${k}]`, o)),
    required: f.required,
    input: resolveInput(f.input),
  };
}

/** Throw a readable error when the slot for this kind is empty (validator normally catches it). */
function need<T>(value: T | null, path: string, slot: string): T {
  if (value === null) throw new Error(`${path}: kind needs \`${slot}\``);
  return value;
}

function resolveItem(ctx: Ctx, path: string, item: ItemDraft): FormItem {
  switch (item.kind) {
    case "paragraph":
    case "note":
      return { kind: item.kind, text: text(ctx, `${path}.text`, need(item.text, path, "text")) };
    case "list":
      return { kind: "list", items: need(item.list_items, path, "list_items").map((r, k) => text(ctx, `${path}.list_items[${k}]`, r)) };
    case "table":
      return {
        kind: "table",
        rows: need(item.table_rows, path, "table_rows").map((row, r) =>
          row.map((cell, c) => text(ctx, `${path}.table_rows[${r}][${c}]`, cell)),
        ),
      };
    case "field":
      return resolveField(ctx, `${path}.field`, need(item.field, path, "field"));
  }
}

function resolveSection(ctx: Ctx, path: string, s: SectionDraft): FormSection {
  return {
    region: s.region,
    title: s.title === null ? null : text(ctx, `${path}.title`, s.title),
    continues_previous_page: s.continues_previous_page,
    items: s.items.map((item, i) => resolveItem(ctx, `${path}.items[${i}]`, item)),
  };
}

/**
 * Resolve one page draft into a FormPage with status "ok".
 * `notes` lists every text that normalization changed.
 */
export function resolvePage(doc: PdfDoc, draft: PageDraft): { page: FormPage; notes: ResolveNote[] } {
  const pdfPage = findPage(doc, draft.page);
  if (!pdfPage) throw new Error(`Page ${draft.page} does not exist`);
  const ctx: Ctx = { index: indexPage(pdfPage), notes: [] };
  const sections = draft.sections.map((s, i) => resolveSection(ctx, `sections[${i}]`, s));
  return { page: { page: draft.page, status: "ok", sections }, notes: ctx.notes };
}

/** What the pipeline knows about one page after the agent ran. */
export interface PageResult {
  draft: PageDraft | null;
  status: "ok" | "failed";
}

/**
 * Build the whole Form. Every page of the doc appears, in order. A page that failed
 * (no draft, status "failed", or a draft that cannot be resolved) becomes an empty
 * page with status "failed" so downstream code can see the gap.
 */
export function resolveForm(doc: PdfDoc, results: Map<number, PageResult> | Record<number, PageResult>): Form {
  const get = (n: number): PageResult | undefined => (results instanceof Map ? results.get(n) : results[n]);
  const pages = doc.pages.map((p): FormPage => {
    const failed: FormPage = { page: p.page, status: "failed", sections: [] };
    const r = get(p.page);
    if (!r || r.status === "failed" || r.draft === null) return failed;
    try {
      return resolvePage(doc, r.draft).page;
    } catch {
      return failed;
    }
  });
  return { source_file: doc.sourceFile, page_count: doc.pageCount, is_acroform: doc.isAcroForm, pages };
}
