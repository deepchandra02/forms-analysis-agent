/**
 * schema/draft.ts — what the AI is allowed to answer for ONE page (the "PageDraft").
 *
 * WHAT:   A zod schema. The AI never writes form text here. It only POINTS at text
 *         using IDs (see src/pdf/types.ts for the ID format). A script later replaces
 *         every pointer with the exact PDF text (src/grounding/resolve.ts).
 * INPUT:  none (schema only)
 * OUTPUT: PageDraftSchema (zod) + PageDraft (TS type)
 * USED BY: the agent (as its responseFormat), the check_draft tool, the validator, the resolver.
 *
 * WHY IT LOOKS THIS WAY (Azure OpenAI "strict" structured outputs):
 *   - Every property is required. "Optional" is expressed as `nullable` (value can be null).
 *   - No unions at the item level: one flat Item object with a `kind` plus nullable slots.
 *     The validator (E_KIND_SHAPE) checks that the right slot is filled for each kind.
 *   - At most 5 levels of nesting and at most 100 properties in total. TextRef is a STRING
 *     (not an array) to save one nesting level.
 *   - No min/max/pattern/format keywords (Azure rejects them). Rules live in the validator.
 *
 * TEXTREF SYNTAX (a string that points at one or more spans, joined in order):
 *   "p1.s14"               one span
 *   "p1.s3-p1.s7"          a contiguous range (s3, s4, s5, s6, s7)
 *   "p1.s3,p1.s9"          a list
 *   "p1.s3-p1.s5,p1.s9"    a mix of both
 */
import { z } from "zod";

/** Points at one or more spans. See the TEXTREF SYNTAX section above. */
export const TextRef = z
  .string()
  .describe('Span IDs, e.g. "p1.s14", "p1.s3-p1.s7" or "p1.s3,p1.s9". Never free text.');

/** Points at exactly one thing: a span, widget, widget option or rule ID. */
export const Ref = z.string().describe('One ID, e.g. "p1.w3", "p1.w3.o0" or "p1.r5".');

export const REGIONS = ["letterhead", "header", "body", "footer"] as const;
export const ITEM_KINDS = ["paragraph", "list", "table", "field", "note"] as const;
export const FIELD_TYPES = [
  "text",
  "multiline_text",
  "date",
  "number",
  "dropdown",
  "checkbox",
  "radio",
  "signature",
] as const;
export const IGNORE_REASONS = [
  "barcode",
  "page_number",
  "list_marker",
  "footnote_marker",
  "decoration",
  "other",
] as const;

export const FieldDraftSchema = z
  .object({
    label: TextRef.describe("The printed label of the field."),
    field_type: z.enum(FIELD_TYPES),
    input: Ref.nullable().describe(
      "The widget ID (AcroForm) or rule ID (drawn line/box) where the person writes. null if none is visible.",
    ),
    hints: z
      .array(TextRef)
      .describe('Printed helper text next to the label, e.g. "(dd.mm.yyyy)" or "(mandatory field)". Empty array if none.'),
    options: z
      .array(Ref)
      .nullable()
      .describe('For dropdown/radio/checkbox groups: option IDs ("p1.w3.o0") or span IDs of printed options. Otherwise null.'),
    required: z.boolean(),
    required_evidence: TextRef.nullable().describe(
      'The span(s) that PROVE the field is required (e.g. "(mandatory field)"). Must be non-null when required=true.',
    ),
  })
  .strict();

export const ItemDraftSchema = z
  .object({
    kind: z.enum(ITEM_KINDS),
    text: TextRef.nullable().describe("For kind=paragraph or note. Otherwise null."),
    list_items: z.array(TextRef).nullable().describe("For kind=list: one TextRef per bullet. Otherwise null."),
    table_rows: z
      .array(z.array(TextRef))
      .nullable()
      .describe("For kind=table: rows, each an array of cells (TextRef). Otherwise null."),
    field: FieldDraftSchema.nullable().describe("For kind=field. Otherwise null."),
  })
  .strict();

export const SectionDraftSchema = z
  .object({
    region: z.enum(REGIONS),
    title: TextRef.nullable().describe("The section heading, or null if the section has none."),
    continues_previous_page: z
      .boolean()
      .describe("true if this section is the continuation of the last section of the previous page."),
    items: z.array(ItemDraftSchema),
  })
  .strict();

export const IgnoredDraftSchema = z
  .object({
    refs: TextRef,
    reason: z.enum(IGNORE_REASONS),
  })
  .strict();

export const PageDraftSchema = z
  .object({
    // Plain number on purpose: `.int()` emits minimum/maximum, which Azure strict mode rejects.
    // The validator checks that it is a real page number (E_WRONG_PAGE_REF).
    page: z.number().describe("The 1-based page number this draft describes."),
    sections: z.array(SectionDraftSchema),
    ignored: z
      .array(IgnoredDraftSchema)
      .describe("Spans that are deliberately left out (barcodes, page numbers, bullet glyphs, …)."),
  })
  .strict();

export type FieldDraft = z.infer<typeof FieldDraftSchema>;
export type ItemDraft = z.infer<typeof ItemDraftSchema>;
export type SectionDraft = z.infer<typeof SectionDraftSchema>;
export type IgnoredDraft = z.infer<typeof IgnoredDraftSchema>;
export type PageDraft = z.infer<typeof PageDraftSchema>;
export type FieldType = (typeof FIELD_TYPES)[number];
export type Region = (typeof REGIONS)[number];
export type IgnoreReason = (typeof IGNORE_REASONS)[number];
