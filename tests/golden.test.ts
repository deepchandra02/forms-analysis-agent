/**
 * golden.test.ts — the hand-written "perfect model answer" for the real sample form.
 *
 * WHAT: tests/fixtures/event-of-death.draft.json is what a flawless model would answer for
 *       sample-forms/event-of-death-en.pdf. Here we check that it passes the validator with
 *       0 errors, that it resolves to the expected texts, and that the resolved Form still
 *       equals the stored fixture tests/fixtures/event-of-death.form.json (regression test).
 * WHY:  it is the ground truth for prompts/docs, and it catches regressions in extraction,
 *       validation, normalization and resolution on a REAL document, not only synthetic ones.
 *
 * To regenerate the Form fixture after an intended change:  UPDATE_GOLDEN=1 npx vitest run tests/golden.test.ts
 *
 * MAPPING DECISIONS (things a reader would otherwise question):
 *  - Label position differs by area. In the body, labels are printed BELOW their widget/underline
 *    (widget p1.w4 sits above "Last name"). In the page-top header, labels sit ABOVE their boxes.
 *  - "Banking relationship" has TWO boxes (w1, w2) on one underline. A field has only one input,
 *    so it is two fields sharing the same label span (validator tolerates label-to-label repeats).
 *  - "Number of existing beneficiaries: ________" (p2.s33, y=403) has its widget p2.w4 at y=359,
 *    inside the bold "Please ensure..." paragraph. It is the page's only free widget, so it is that
 *    label's input; the 29pt gap is below the 150pt W_LABEL_FAR_FROM_INPUT threshold.
 *    The printed underscores stay in the label because the label is one span (we never edit text).
 *  - p3.w4 is a pre-filled instruction box whose value span p3.s3 is cited as a note, so the widget
 *    counts as accounted for.
 *  - "(mandatory field)" is part of the AHV label span. That same span is also the required_evidence
 *    (the validator allows evidence to re-cite a span; see validate.ts).
 *  - p3 "Signature of beneficiary" has no widget; its drawn line p3.r20 is the input (type signature).
 *  - "For internal bank use only" fields (OU ref., Signature) have no widget or line: input = null.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { formatReport, validatePage } from "../src/grounding/validate.js";
import { resolveForm, type PageResult } from "../src/grounding/resolve.js";
import type { PdfDoc } from "../src/pdf/types.js";
import type { PageDraft } from "../src/schema/draft.js";
import { FormSchema, type Form, type FormItem } from "../src/schema/form.js";
import { FORM_PATH, loadDoc, loadDrafts } from "./fixtures/golden.js";

let doc: PdfDoc;
let drafts: PageDraft[];
let form: Form;

beforeAll(async () => {
  doc = await loadDoc();
  drafts = loadDrafts();
  const results = new Map<number, PageResult>(drafts.map((d) => [d.page, { draft: d, status: "ok" }]));
  form = resolveForm(doc, results);
});

/** All items of a page, flattened. */
const itemsOf = (page: number): FormItem[] => form.pages[page - 1]!.sections.flatMap((s) => s.items);
const fieldsOf = (page: number) => itemsOf(page).filter((i) => i.kind === "field");

describe("golden draft validates", () => {
  it.each([1, 2, 3])("page %i has 0 errors", (n) => {
    const report = validatePage(doc, drafts[n - 1]);
    // Print the readable report if this ever fails.
    expect(report.errors, formatReport(report)).toEqual([]);
  });

  it("warnings are exactly the expected ones", () => {
    const codes = (n: number) => validatePage(doc, drafts[n - 1]).warnings.map((w) => w.code);
    // p1: only the "main-/taining" de-hyphenation.
    expect(codes(1)).toEqual(["W_NORMALIZED"]);
    // p2: clean (p2.w4 is 29pt from its label, under the threshold).
    expect(codes(2)).toEqual([]);
    // p3: signature on a drawn line + two bank-use fields without any input.
    expect(codes(3).sort()).toEqual(["W_NO_INPUT", "W_NO_INPUT", "W_TYPE_INFERRED", "W_TYPE_INFERRED", "W_TYPE_INFERRED"]);
  });
});

describe("golden draft resolves to the right texts", () => {
  it("is a valid Form with 3 ok pages", () => {
    expect(FormSchema.safeParse(form).success).toBe(true);
    expect(form.pages.map((p) => p.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("title and group list (de-hyphenated)", () => {
    const titles = form.pages[0]!.sections.map((s) => s.title);
    expect(titles).toContain("Payment of UBS Fisca 3a (pillar 3a) in the event of death");
    const list = itemsOf(1).find((i) => i.kind === "list");
    expect(list).toMatchObject({ kind: "list" });
    const groups = (list as { items: string[] }).items;
    expect(groups).toHaveLength(5);
    expect(groups[0]).toBe("Group 1: the surviving spouse or registered partner");
    expect(groups[1]).toBe(
      "Group 2: the direct descendants and any natural persons for whose maintenance the deceased was significantly responsible, " +
        "or the person who was living with the deceased in a permanent domestic relationship for the last five years immediately " +
        "prior to their death, or who is responsible for maintaining one or more joint children",
    );
  });

  it("marital status is a dropdown with the 7 widget options", () => {
    const f = fieldsOf(1).find((i) => i.kind === "field" && i.label === "Marital status");
    expect(f).toMatchObject({
      field_type: "dropdown",
      options: ["Single", "Married", "Divorced", "Widowed", "registered partnership", "diss.partnership, death", "diss.partnership, legal"],
    });
  });

  it("AHV field is required and carries its hint", () => {
    const f = fieldsOf(1).find((i) => i.kind === "field" && i.label.startsWith("AHV number"));
    expect(f).toMatchObject({ required: true, hints: ["(756.xxxx.xxxx.xx)"], label: "AHV number / Social security number (mandatory field)" });
  });

  it("page-3 instruction note comes from the pre-filled widget value span", () => {
    expect(itemsOf(3)).toContainEqual({ kind: "note", text: "Complete and print out this page for each beneficiary." });
  });

  it("field counts per page", () => {
    // p1: 3 header + 9 details. p2: 3 header + 1. p3: 3 header + 9 + 3 + 5 + 2.
    expect(fieldsOf(1)).toHaveLength(12);
    expect(fieldsOf(2)).toHaveLength(4);
    expect(fieldsOf(3)).toHaveLength(22);
  });

  it("page-1 field summary (label -> type)", () => {
    const summary = fieldsOf(1).map((f) => (f.kind === "field" ? `${f.label} -> ${f.field_type}` : ""));
    expect(summary).toEqual([
      "Banking relationship -> text",
      "Banking relationship -> text",
      "UBS Fisca 3a no. -> text",
      "Last name -> text",
      "First name(s) -> text",
      "Street, no. -> text",
      "Postal code, city -> text",
      "Country -> text",
      "Date of birth (dd.mm.yyyy) -> date",
      "Date of death -> date",
      "Marital status -> dropdown",
      "AHV number / Social security number (mandatory field) -> text",
    ]);
  });
});

describe("regression: resolved Form equals the stored fixture", () => {
  it("matches tests/fixtures/event-of-death.form.json", () => {
    if (process.env.UPDATE_GOLDEN) writeFileSync(FORM_PATH, JSON.stringify(form, null, 2) + "\n");
    expect(form).toEqual(JSON.parse(readFileSync(FORM_PATH, "utf8")));
  });
});
