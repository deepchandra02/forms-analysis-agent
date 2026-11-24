/**
 * golden.mutations.test.ts — break the golden draft on purpose; the validator must notice.
 *
 * WHAT: each test clones the golden draft of one page of the REAL form, applies one defect and
 *       expects a specific error code.
 * WHY:  proves the validator's guarantees hold on a real document (nothing skipped, nothing
 *       duplicated, nothing invented), not only on the small synthetic fixture.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { validatePage } from "../src/grounding/validate.js";
import type { PdfDoc } from "../src/pdf/types.js";
import type { PageDraft } from "../src/schema/draft.js";
import { loadDoc, loadDrafts } from "./fixtures/golden.js";

let doc: PdfDoc;
let golden: PageDraft[];

beforeAll(async () => {
  doc = await loadDoc();
  golden = loadDrafts();
});

/** Clone page `n`'s golden draft, mutate it, and return the error codes. */
function errorsAfter(n: number, mutate: (d: PageDraft) => void): string[] {
  const draft = structuredClone(golden[n - 1]!);
  mutate(draft);
  return validatePage(doc, draft).errors.map((e) => e.code);
}

/** The body section titled by `titleRef` on a draft (throws if absent: keeps tests honest). */
const section = (d: PageDraft, titleRef: string) => d.sections.find((s) => s.title === titleRef)!;
/** Find the field item with this label ref anywhere on the page. */
const fieldItem = (d: PageDraft, labelRef: string) =>
  d.sections.flatMap((s) => s.items).find((i) => i.kind === "field" && i.field!.label === labelRef)!.field!;

describe("mutations of the golden draft", () => {
  it("control: untouched golden has no errors", () => {
    expect(errorsAfter(1, () => {})).toEqual([]);
  });

  it("dropping a span from coverage -> E_UNACCOUNTED_SPAN", () => {
    // Remove the "page 1/3" ignore entry.
    expect(errorsAfter(1, (d) => (d.ignored = d.ignored.filter((i) => i.refs !== "p1.s44")))).toContain("E_UNACCOUNTED_SPAN");
  });

  it("citing a span twice -> E_DUPLICATE_REF", () => {
    // The title span is also used as a paragraph text.
    expect(errorsAfter(1, (d) => section(d, "p1.s10").items.push({ kind: "note", text: "p1.s9", list_items: null, table_rows: null, field: null }))).toContain("E_DUPLICATE_REF");
  });

  it("citing a span of another page -> E_WRONG_PAGE_REF", () => {
    expect(errorsAfter(1, (d) => (d.ignored[0]!.refs = "p9.s1"))).toContain("E_WRONG_PAGE_REF");
  });

  it("citing a span that does not exist -> E_UNKNOWN_REF", () => {
    expect(errorsAfter(1, (d) => (d.ignored[0]!.refs = "p1.s999"))).toContain("E_UNKNOWN_REF");
  });

  it("dropdown typed as text -> E_WIDGET_TYPE_MISMATCH", () => {
    expect(errorsAfter(1, (d) => (fieldItem(d, "p1.s36").field_type = "text"))).toContain("E_WIDGET_TYPE_MISMATCH");
  });

  it("removing a dropdown option -> E_OPTIONS_MISMATCH", () => {
    expect(errorsAfter(1, (d) => fieldItem(d, "p1.s36").options!.pop())).toContain("E_OPTIONS_MISMATCH");
  });

  it("required without evidence -> E_REQUIRED_NO_EVIDENCE", () => {
    expect(errorsAfter(1, (d) => (fieldItem(d, "p1.s37").required_evidence = null))).toContain("E_REQUIRED_NO_EVIDENCE");
  });

  it("dropping a field that uses a widget -> E_UNUSED_WIDGET", () => {
    // Remove the "Last name" field (widget p1.w4). Its label span also becomes unaccounted.
    const codes = errorsAfter(1, (d) => {
      const sec = section(d, "p1.s27");
      sec.items = sec.items.filter((i) => !(i.kind === "field" && i.field!.label === "p1.s29"));
    });
    expect(codes).toContain("E_UNUSED_WIDGET");
    expect(codes).toContain("E_UNACCOUNTED_SPAN");
  });

  it("evidence may re-cite the label span, but other duplicates stay errors", () => {
    // Golden already does this for AHV and has 0 errors; a hint re-citing the label must fail.
    expect(errorsAfter(1, (d) => fieldItem(d, "p1.s37").hints.push("p1.s37"))).toContain("E_DUPLICATE_REF");
  });
});
