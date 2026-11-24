import { describe, expect, it } from "vitest";
import { collectRefs, formatId, parseId, parseTextRef, RefError, safeParseTextRef } from "../src/schema/refs.js";
import { makeValidDraft } from "./fixtures/synthetic-doc.js";

describe("parseId", () => {
  it("parses each kind", () => {
    expect(parseId("p1.s3")).toEqual({ type: "span", page: 1, index: 3 });
    expect(parseId("p2.w3")).toEqual({ type: "widget", page: 2, index: 3 });
    expect(parseId("p1.w3.o0")).toEqual({ type: "option", page: 1, widget: 3, index: 0 });
    expect(parseId("p10.r5")).toEqual({ type: "rule", page: 10, index: 5 });
  });
  it("rejects malformed ids", () => {
    for (const bad of ["", "s3", "p0.s1", "p1.s01", "p1.x3", "p1.s3-p1.s4", "p1.w3.o", "P1.s3"]) {
      expect(() => parseId(bad), bad).toThrow(RefError);
    }
  });
  it("formatId round-trips", () => {
    for (const id of ["p1.s3", "p4.w2", "p1.w3.o0", "p9.r12"]) expect(formatId(parseId(id))).toBe(id);
  });
});

describe("parseTextRef", () => {
  it("single, range, list and mix", () => {
    expect(parseTextRef("p1.s14")).toEqual(["p1.s14"]);
    expect(parseTextRef("p1.s3-p1.s5")).toEqual(["p1.s3", "p1.s4", "p1.s5"]);
    expect(parseTextRef("p1.s3,p1.s9")).toEqual(["p1.s3", "p1.s9"]);
    expect(parseTextRef("p1.s3-p1.s5,p1.s9")).toEqual(["p1.s3", "p1.s4", "p1.s5", "p1.s9"]);
    expect(parseTextRef(" p1.s3 , p1.s4 ")).toEqual(["p1.s3", "p1.s4"]);
  });
  it("rejects malformed refs", () => {
    const bad = ["", "p1.s3,", "p1.s3-", "p1.s5-p1.s3", "p1.s1-p2.s2", "p1.s1-p1.s2-p1.s3", "hello", "p1.w3", "p1.s1-p1.w2", "p1.s1-p1.s9999"];
    for (const b of bad) expect(() => parseTextRef(b), b).toThrow(RefError);
  });
  it("safeParseTextRef does not throw", () => {
    expect(safeParseTextRef("p1.s1")).toEqual({ ok: true, ids: ["p1.s1"] });
    expect(safeParseTextRef("nope").ok).toBe(false);
  });
});

describe("collectRefs", () => {
  it("lists every ref with its JSON path", () => {
    const uses = collectRefs(makeValidDraft());
    const byPath = Object.fromEntries(uses.map((u) => [u.path, u]));
    expect(byPath["sections[0].title"]).toMatchObject({ raw: "p1.s1", kind: "text" });
    expect(byPath["sections[0].items[0].text"]).toMatchObject({ raw: "p1.s2", kind: "text" });
    expect(byPath["sections[0].items[1].field.label"]).toMatchObject({ raw: "p1.s3", kind: "text" });
    expect(byPath["sections[0].items[1].field.input"]).toMatchObject({ raw: "p1.w1", kind: "input" });
    expect(byPath["sections[0].items[1].field.required_evidence"]).toMatchObject({ raw: "p1.s4" });
    expect(byPath["sections[0].items[2].field.options[1]"]).toMatchObject({ raw: "p1.w2.o1", kind: "option" });
    expect(byPath["ignored[0].refs"]).toMatchObject({ raw: "p1.s8", kind: "ignored" });
  });
  it("covers list items, table cells and hints", () => {
    const d = makeValidDraft();
    d.sections[0]!.items.push(
      { kind: "list", text: null, list_items: ["p1.s1", "p1.s2"], table_rows: null, field: null },
      { kind: "table", text: null, list_items: null, table_rows: [["p1.s3", "p1.s4"]], field: null },
    );
    const paths = collectRefs(d).map((u) => u.path);
    expect(paths).toContain("sections[0].items[5].list_items[1]");
    expect(paths).toContain("sections[0].items[6].table_rows[0][1]");
  });
});
