import { describe, expect, it } from "vitest";
import { resolveForm, resolvePage } from "../src/grounding/resolve.js";
import { FormSchema } from "../src/schema/form.js";
import { makeDoc, makeValidDraft } from "./fixtures/synthetic-doc.js";

describe("resolvePage", () => {
  it("replaces ids with exact text", () => {
    const { page, notes } = resolvePage(makeDoc(), makeValidDraft());
    expect(notes).toEqual([]);
    expect(page.status).toBe("ok");
    const sec = page.sections[0]!;
    expect(sec.title).toBe("Application Form");
    expect(sec.items[0]).toEqual({ kind: "paragraph", text: "Please fill in all fields." });
    expect(sec.items[1]).toEqual({
      kind: "field", label: "Last name", field_type: "text", hints: [], options: null, required: true, input: "widget",
    });
    expect(sec.items[2]).toMatchObject({ options: ["Germany", "France"], input: "widget" });
    expect(sec.items[3]).toMatchObject({ field_type: "signature", input: "rule" });
  });

  it("span ids in options become span text; null input becomes 'none'", () => {
    const d = makeValidDraft();
    const f = d.sections[0]!.items[3]!.field!;
    f.field_type = "radio";
    f.input = null;
    f.options = ["p1.s2"];
    const doc = makeDoc();
    const item = resolvePage(doc, { ...d, sections: [{ ...d.sections[0]!, items: [d.sections[0]!.items[3]!] }] }).page.sections[0]!.items[0]!;
    expect(item).toMatchObject({ options: ["Please fill in all fields."], input: "none" });
  });

  it("handles list and table items and records normalization notes", () => {
    const doc = makeDoc();
    doc.pages[0]!.spans[1]!.text = "Please  fill in all fields.";
    const d = makeValidDraft();
    d.sections[0]!.items = [
      { kind: "list", text: null, list_items: ["p1.s2", "p1.s3"], table_rows: null, field: null },
      { kind: "table", text: null, list_items: null, table_rows: [["p1.s5", "p1.s6"]], field: null },
      { kind: "note", text: "p1.s7", list_items: null, table_rows: null, field: null },
    ];
    const { page, notes } = resolvePage(doc, d);
    expect(page.sections[0]!.items).toEqual([
      { kind: "list", items: ["Please fill in all fields.", "Last name"] },
      { kind: "table", rows: [["Country", "Signature"]] },
      { kind: "note", text: "Date" },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ path: "sections[0].items[0].list_items[0]", rules: ["whitespace"] });
  });

  it("throws on unknown refs", () => {
    const d = makeValidDraft();
    d.sections[0]!.title = "p1.s99";
    expect(() => resolvePage(makeDoc(), d)).toThrow();
  });
});

describe("resolveForm", () => {
  it("builds a schema-valid Form; failed pages are empty", () => {
    const doc = makeDoc();
    doc.pageCount = 2;
    doc.pages.push({ page: 2, width: 595, height: 842, spans: [], widgets: [], rules: [] });
    const form = resolveForm(doc, new Map([[1, { draft: makeValidDraft(), status: "ok" as const }]]));
    expect(FormSchema.safeParse(form).success).toBe(true);
    expect(form).toMatchObject({ source_file: "synthetic.pdf", page_count: 2, is_acroform: true });
    expect(form.pages[0]!.status).toBe("ok");
    expect(form.pages[1]).toEqual({ page: 2, status: "failed", sections: [] });
  });
  it("accepts a plain record and marks unresolvable drafts failed", () => {
    const bad = makeValidDraft();
    bad.sections[0]!.title = "p1.s99";
    const form = resolveForm(makeDoc(), { 1: { draft: bad, status: "ok" } });
    expect(form.pages[0]!.status).toBe("failed");
  });
});
