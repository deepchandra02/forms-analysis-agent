/**
 * tests/fixtures/golden.ts — shared loader for the golden tests.
 *
 * WHAT: extracts the real sample PDF once (cached) and loads the hand-written golden drafts.
 * WHY:  golden.test.ts and golden.mutations.test.ts both need the same doc + drafts;
 *       extracting the PDF twice would just slow the suite down.
 */
import { readFileSync } from "node:fs";
import { extractPdf } from "../../src/pdf/extract.js";
import type { PdfDoc } from "../../src/pdf/types.js";
import type { PageDraft } from "../../src/schema/draft.js";

export const PDF_PATH = "sample-forms/event-of-death-en.pdf";
export const DRAFT_PATH = "tests/fixtures/event-of-death.draft.json";
export const FORM_PATH = "tests/fixtures/event-of-death.form.json";

let docPromise: Promise<PdfDoc> | undefined;

/** The extracted real PDF (extracted once per test file's module graph). */
export function loadDoc(): Promise<PdfDoc> {
  docPromise ??= extractPdf(PDF_PATH);
  return docPromise;
}

/** Fresh copy of the golden drafts (one PageDraft per page). Safe to mutate. */
export function loadDrafts(): PageDraft[] {
  return JSON.parse(readFileSync(DRAFT_PATH, "utf8")) as PageDraft[];
}
