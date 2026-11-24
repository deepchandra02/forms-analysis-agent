/**
 * schema/form.ts — the FINAL, resolved output: the form as clean structured text.
 *
 * WHAT:   Same structure as the PageDraft, but every ID pointer is replaced by the exact
 *         PDF text and there are no nullable "slots": each item kind has exactly the
 *         fields it needs (a discriminated union on `kind`). Later agents consume this.
 * INPUT:  none (schema only)
 * OUTPUT: FormSchema (zod) + Form / FormPage / FormSection / FormItem / ReviewItem types
 * USED BY: src/grounding/resolve.ts (produces it), downstream agents (consume it)
 *
 * NOTE: span IDs are deliberately NOT here. The PageDraft is saved next to the Form
 * as provenance (it says which spans each text came from).
 */
import { z } from "zod";
import { FIELD_TYPES, REGIONS } from "./draft.js";

export const INPUT_KINDS = ["widget", "rule", "none"] as const;

export const FormFieldSchema = z
  .object({
    kind: z.literal("field"),
    label: z.string(),
    field_type: z.enum(FIELD_TYPES),
    hints: z.array(z.string()),
    /** Display texts of the options; null when the field has no options. */
    options: z.array(z.string()).nullable(),
    required: z.boolean(),
    /** Where the person writes: an AcroForm widget, a drawn rule/box, or nothing visible. */
    input: z.enum(INPUT_KINDS),
  })
  .strict();

export const FormItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), text: z.string() }).strict(),
  z.object({ kind: z.literal("note"), text: z.string() }).strict(),
  z.object({ kind: z.literal("list"), items: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("table"), rows: z.array(z.array(z.string())) }).strict(),
  FormFieldSchema,
]);

export const FormSectionSchema = z
  .object({
    region: z.enum(REGIONS),
    title: z.string().nullable(),
    continues_previous_page: z.boolean(),
    items: z.array(FormItemSchema),
  })
  .strict();

export const FormPageSchema = z
  .object({
    page: z.number().int(),
    /** "failed" = the agent could not produce a valid draft; sections is then empty. */
    status: z.enum(["ok", "failed"]),
    sections: z.array(FormSectionSchema),
  })
  .strict();

export const FormSchema = z
  .object({
    source_file: z.string(),
    page_count: z.number().int(),
    is_acroform: z.boolean(),
    pages: z.array(FormPageSchema),
  })
  .strict();

export type FormField = z.infer<typeof FormFieldSchema>;
export type FormItem = z.infer<typeof FormItemSchema>;
export type FormSection = z.infer<typeof FormSectionSchema>;
export type FormPage = z.infer<typeof FormPageSchema>;
export type Form = z.infer<typeof FormSchema>;

/** One thing a human should look at (a warning, or a failed page), for the review list. */
export interface ReviewItem {
  code: string;
  page: number;
  path: string;
  message: string;
}
