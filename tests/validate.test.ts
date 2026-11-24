import { describe, expect, it } from "vitest";
import { formatReport, validatePage } from "../src/grounding/validate.js";
import type { PageDraft } from "../src/schema/draft.js";
import type { PdfDoc } from "../src/pdf/types.js";
import { makeDoc, makeValidDraft } from "./fixtures/synthetic-doc.js";

const doc = makeDoc();
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);
const warnCodes = (r: { warnings: { code: string }[] }) => r.warnings.map((e) => e.code);

/** Apply a mutation to a fresh valid draft and validate. */
function run(mutate: (d: PageDraft) => void, d: PdfDoc = doc) {
  const draft = makeValidDraft();
  mutate(draft);
  return validatePage(d, draft);
}
const items = (d: PageDraft) => d.sections[0]!.items;

describe("valid draft", () => {
  it("has 0 errors; only the expected warnings (rule-based types)", () => {
    const r = validatePage(doc, makeValidDraft());
    expect(r.errors).toEqual([]);
    expect(new Set(warnCodes(r))).toEqual(new Set(["W_TYPE_INFERRED"]));
    expect(formatReport(r)).toContain("acceptable");
  });
});

describe("errors (one mutation per code)", () => {
  it("E_SCHEMA", () => {
    expect(codes(validatePage(doc, {}))).toContain("E_SCHEMA");
    expect(codes(validatePage(doc, { page: 1, sections: [], ignored: [], extra: 1 }))).toContain("E_SCHEMA");
  });
  it("E_BAD_REF", () => {
    expect(codes(run((d) => (items(d)[0]!.text = "garbage")))).toContain("E_BAD_REF");
    expect(codes(run((d) => (items(d)[1]!.field!.input = "p1.w1-p1.w2")))).toContain("E_BAD_REF");
  });
  it("E_UNKNOWN_REF", () => {
    expect(codes(run((d) => (d.sections[0]!.title = "p1.s99")))).toContain("E_UNKNOWN_REF");
    expect(codes(run((d) => (items(d)[1]!.field!.input = "p1.w9")))).toContain("E_UNKNOWN_REF");
    expect(codes(run((d) => (items(d)[2]!.field!.options = ["p1.w2.o7"])))).toContain("E_UNKNOWN_REF");
  });
  it("E_WRONG_PAGE_REF", () => {
    expect(codes(run((d) => (items(d)[0]!.text = "p2.s1")))).toContain("E_WRONG_PAGE_REF");
    expect(codes(run((d) => (d.page = 5)))).toContain("E_WRONG_PAGE_REF");
  });
  it("E_DUPLICATE_REF (also against ignored)", () => {
    expect(codes(run((d) => (items(d)[0]!.text = "p1.s1")))).toContain("E_DUPLICATE_REF");
    expect(codes(run((d) => d.ignored.push({ refs: "p1.s1", reason: "other" })))).toContain("E_DUPLICATE_REF");
  });
  it("E_UNACCOUNTED_SPAN lists span and its text", () => {
    const r = run((d) => (d.ignored = []));
    const e = r.errors.find((x) => x.code === "E_UNACCOUNTED_SPAN")!;
    expect(e.refs).toEqual(["p1.s8"]);
    expect(e.message).toContain("Page 1/3");
  });
  it("E_UNUSED_WIDGET (with exemptions)", () => {
    expect(codes(run((d) => (items(d)[1]!.field!.input = null)))).toContain("E_UNUSED_WIDGET");
    // pushbutton is exempt
    const d2 = makeDoc();
    d2.pages[0]!.widgets.push({ id: "p1.w3", page: 1, kind: "pushbutton", box: { x: 0, y: 0, w: 10, h: 10 }, multiline: false, options: [], value: null, valueSpanId: null });
    expect(codes(run(() => {}, d2))).not.toContain("E_UNUSED_WIDGET");
    // widget whose value span is cited is accounted for
    const d3 = makeDoc();
    d3.pages[0]!.widgets.push({ id: "p1.w3", page: 1, kind: "text", box: { x: 0, y: 0, w: 10, h: 10 }, multiline: false, options: [], value: "x", valueSpanId: "p1.s8" });
    d3.pages[0]!.spans[7]!.source = "widget";
    d3.pages[0]!.spans[7]!.widgetId = "p1.w3";
    expect(codes(run((d) => { d.ignored = []; items(d)[0]!.text = "p1.s2"; d.sections[0]!.title = "p1.s1"; items(d).push({ kind: "note", text: "p1.s8", list_items: null, table_rows: null, field: null }); }, d3))).not.toContain("E_UNUSED_WIDGET");
  });
  it("E_WIDGET_TYPE_MISMATCH", () => {
    expect(codes(run((d) => (items(d)[1]!.field!.field_type = "checkbox")))).toContain("E_WIDGET_TYPE_MISMATCH");
    expect(codes(run((d) => (items(d)[1]!.field!.input = "p1.s2")))).toContain("E_WIDGET_TYPE_MISMATCH");
  });
  it("E_OPTIONS_MISMATCH", () => {
    expect(codes(run((d) => (items(d)[2]!.field!.options = ["p1.w2.o1", "p1.w2.o0"])))).toContain("E_OPTIONS_MISMATCH");
    expect(codes(run((d) => (items(d)[2]!.field!.options = ["p1.w2.o0"])))).toContain("E_OPTIONS_MISMATCH");
    expect(codes(run((d) => { const f = items(d)[3]!.field!; f.field_type = "radio"; f.options = ["p1.w2.o0"]; }))).toContain("E_OPTIONS_MISMATCH");
    expect(codes(run((d) => (items(d)[1]!.field!.options = ["p1.s2"])))).toContain("E_OPTIONS_MISMATCH");
  });
  it("E_KIND_SHAPE", () => {
    expect(codes(run((d) => (items(d)[0]!.text = null)))).toContain("E_KIND_SHAPE");
    expect(codes(run((d) => (items(d)[0]!.list_items = ["p1.s2"])))).toContain("E_KIND_SHAPE");
    expect(codes(run((d) => items(d).push({ kind: "list", text: null, list_items: [], table_rows: null, field: null })))).toContain("E_KIND_SHAPE");
    expect(codes(run((d) => items(d).push({ kind: "table", text: null, list_items: null, table_rows: null, field: null })))).toContain("E_KIND_SHAPE");
  });
  it("E_REQUIRED_NO_EVIDENCE", () => {
    expect(codes(run((d) => (items(d)[1]!.field!.required_evidence = null)))).toContain("E_REQUIRED_NO_EVIDENCE");
  });
  it("required_evidence may re-cite the label span (no E_DUPLICATE_REF)", () => {
    const r = run((d) => (items(d)[1]!.field!.required_evidence = items(d)[1]!.field!.label));
    expect(codes(r)).not.toContain("E_DUPLICATE_REF");
  });
  it("two fields may share one label span (multi-box rows), but a label cannot repeat a paragraph span", () => {
    const shared = run((d) => items(d).push(structuredClone(items(d)[1]!)));
    expect(codes(shared)).not.toContain("E_DUPLICATE_REF");
    expect(codes(run((d) => (items(d)[1]!.field!.label = items(d)[0]!.text!)))).toContain("E_DUPLICATE_REF");
  });
  it("E_WRONG_REF_TYPE", () => {
    expect(codes(run((d) => (items(d)[0]!.text = "p1.w1")))).toContain("E_WRONG_REF_TYPE");
    expect(codes(run((d) => (items(d)[2]!.field!.options = ["p1.w2", "p1.w2.o1"])))).toContain("E_WRONG_REF_TYPE");
    expect(codes(run((d) => (items(d)[1]!.field!.input = "p1.w2.o0")))).toContain("E_WRONG_REF_TYPE");
  });
});

describe("warnings", () => {
  it("W_NO_INPUT", () => {
    expect(warnCodes(run((d) => (items(d)[3]!.field!.input = null)))).toContain("W_NO_INPUT");
  });
  it("W_TYPE_INFERRED for rule-based fields only", () => {
    const r = run(() => {});
    expect(r.warnings.filter((w) => w.code === "W_TYPE_INFERRED").map((w) => w.path)).toEqual([
      "sections[0].items[3].field.field_type",
      "sections[0].items[4].field.field_type",
    ]);
  });
  it("W_LABEL_FAR_FROM_INPUT", () => {
    const far = makeDoc();
    far.pages[0]!.rules[1]!.box = { x: 120, y: 700, w: 100, h: 1 };
    expect(warnCodes(run(() => {}, far))).toContain("W_LABEL_FAR_FROM_INPUT");
    expect(warnCodes(run(() => {}))).not.toContain("W_LABEL_FAR_FROM_INPUT");
  });
  it("W_NORMALIZED includes before and after", () => {
    const messy = makeDoc();
    messy.pages[0]!.spans[1]!.text = "Please  fill in all fields.";
    const w = run(() => {}, messy).warnings.find((x) => x.code === "W_NORMALIZED")!;
    expect(w.path).toBe("sections[0].items[0].text");
    expect(w.message).toContain("Please  fill");
    expect(w.message).toContain("Please fill");
  });
});

describe("formatReport", () => {
  it("lists errors compactly and caps long lists", () => {
    const r = run((d) => (d.ignored = []));
    const text = formatReport(r);
    expect(text).toContain("[E_UNACCOUNTED_SPAN]");
    expect(text).toContain("Page 1/3");
    const many = { page: 1, warnings: [], errors: Array.from({ length: 40 }, (_, i) => ({ code: "E_BAD_REF" as const, path: `p${i}`, message: "m" })) };
    expect(formatReport(many)).toContain("... and 10 more");
  });
});
