/**
 * tests/pdf.extract.test.ts — checks the deterministic PDF layer on the two sample forms.
 *
 * WHAT:   Asserts on presence/text of spans, widgets and rules (not exact coordinates),
 *         ID uniqueness and that no internal field names leak.
 * INPUT:  sample-forms/event-of-death-en.pdf, sample-forms/fisca-tranfer-to-ubs-64325-en.pdf
 * OUTPUT: pass/fail
 * USED BY: `npx vitest run`
 */
import { beforeAll, describe, expect, it } from "vitest";
import { extractPdf } from "../src/pdf/extract.js";
import { boxDistance, directionOf, findNearby, getById } from "../src/pdf/geometry.js";
import type { PdfDoc } from "../src/pdf/types.js";

let death: PdfDoc;
let fisca: PdfDoc;

beforeAll(async () => {
  death = await extractPdf("sample-forms/event-of-death-en.pdf");
  fisca = await extractPdf("sample-forms/fisca-tranfer-to-ubs-64325-en.pdf");
});

const texts = (doc: PdfDoc, page: number) => doc.pages[page - 1].spans.map((s) => s.text);

describe("event-of-death-en.pdf", () => {
  it("has 3 pages and is an AcroForm", () => {
    expect(death.sourceFile).toBe("event-of-death-en.pdf");
    expect(death.pageCount).toBe(3);
    expect(death.isAcroForm).toBe(true);
  });

  it("splits 'Last name' and 'First name(s)' into separate spans on the same line", () => {
    const last = death.pages[0].spans.find((s) => s.text === "Last name");
    const first = death.pages[0].spans.find((s) => s.text === "First name(s)");
    expect(last).toBeDefined();
    expect(first).toBeDefined();
    expect(last!.line).toBe(first!.line);
    expect(last!.box.x).toBeLessThan(first!.box.x);
  });

  it("keeps the title as one span", () => {
    expect(texts(death, 1)).toContain("Payment of UBS Fisca 3a (pillar 3a) in the event of death");
  });

  it("separates bold 'Group 1:' from the regular text after it", () => {
    const label = death.pages[0].spans.find((s) => s.text === "Group 1:");
    expect(label?.bold).toBe(true);
    expect(texts(death, 1)).toContain("the surviving spouse or registered partner");
  });

  it("has a small footnote-marker span '1' after the 'Details of the deceased pension holder' heading", () => {
    const spans = death.pages[0].spans;
    const heading = spans.find((s) => s.text === "Details of the deceased pension holder")!;
    const marker = spans.find((s) => s.text === "1" && s.line === heading.line)!;
    expect(marker).toBeDefined();
    expect(marker.fontSize).toBeLessThan(heading.fontSize);
    expect(marker.box.x).toBeGreaterThan(heading.box.x);
  });

  it("emits the vertical barcode number as a span", () => {
    expect(texts(death, 1).some((t) => /^\d{20,}$/.test(t))).toBe(true);
  });

  it("emits the pre-filled widget value on page 3 as a linked span", () => {
    const page = death.pages[2];
    const span = page.spans.find((s) => s.text === "Complete and print out this page for each beneficiary.");
    expect(span?.source).toBe("widget");
    const widget = page.widgets.find((w) => w.id === span!.widgetId)!;
    expect(widget.valueSpanId).toBe(span!.id);
    expect(widget.value).toBe(span!.text);
  });

  it("detects widgets per page", () => {
    expect(death.pages.map((p) => p.widgets.length)).toEqual([12, 4, 20]);
  });

  it("reads the Marital status dropdown with its real options", () => {
    const dropdown = death.pages[0].widgets.find((w) => w.kind === "dropdown")!;
    expect(dropdown.options.map((o) => o.text)).toEqual([
      "Single",
      "Married",
      "Divorced",
      "Widowed",
      "registered partnership",
      "diss.partnership, death",
      "diss.partnership, legal",
    ]);
    for (const o of dropdown.options) expect(o.id.startsWith(dropdown.id + ".o")).toBe(true);
    // The dropdown sits right ABOVE its label (labels are printed under the line on this form).
    const label = death.pages[0].spans.find((s) => s.text === "Marital status")!;
    const above = findNearby(death.pages[0], dropdown.id, { direction: "below", limit: 5 });
    expect(above.find((n) => n.type === "span")?.id).toBe(label.id);
  });

  it("finds field underlines as horizontal rules on page 1", () => {
    const horizontal = death.pages[0].rules.filter((r) => r.orientation === "horizontal");
    expect(horizontal.length).toBeGreaterThanOrEqual(8);
    expect(horizontal.some((r) => r.box.w > 200)).toBe(true);
  });
});

describe("fisca-tranfer-to-ubs-64325-en.pdf", () => {
  it("has 1 page, widgets and a checkbox", () => {
    expect(fisca.pageCount).toBe(1);
    expect(fisca.isAcroForm).toBe(true);
    expect(fisca.pages[0].widgets.length).toBe(21);
    expect(fisca.pages[0].widgets.some((w) => w.kind === "checkbox")).toBe(true);
  });

  it("splits label columns and has rules", () => {
    expect(texts(fisca, 1)).toContain("Last name");
    expect(texts(fisca, 1)).toContain("First name(s)");
    expect(fisca.pages[0].rules.length).toBeGreaterThan(5);
  });
});

describe.each([
  ["event-of-death", () => death],
  ["fisca", () => fisca],
])("ids and privacy: %s", (_name, get) => {
  it("has unique, sequential ids", () => {
    for (const page of get().pages) {
      const p = page.page;
      expect(page.spans.map((s) => s.id)).toEqual(page.spans.map((_, i) => `p${p}.s${i + 1}`));
      expect(page.widgets.map((w) => w.id)).toEqual(page.widgets.map((_, i) => `p${p}.w${i + 1}`));
      expect(page.rules.map((r) => r.id)).toEqual(page.rules.map((_, i) => `p${p}.r${i + 1}`));
      const lines = page.spans.map((s) => s.line);
      expect([...lines].sort((a, b) => a - b)).toEqual(lines); // lines never go backwards
      expect(page.spans.every((s) => s.text.trim() !== "")).toBe(true);
    }
  });

  it("does not leak internal field names", () => {
    const json = JSON.stringify(get());
    expect(json).not.toMatch(/Text\d+/);
    expect(json).not.toContain("fieldName");
  });
});

describe("geometry", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  it("computes distance between boxes", () => {
    expect(boxDistance(a, { x: 20, y: 0, w: 5, h: 10 })).toBe(10);
    expect(boxDistance(a, { x: 5, y: 5, w: 5, h: 5 })).toBe(0);
  });
  it("computes direction of b relative to a", () => {
    expect(directionOf(a, { x: 0, y: -30, w: 10, h: 10 })).toBe("above");
    expect(directionOf(a, { x: 0, y: 30, w: 10, h: 10 })).toBe("below");
    expect(directionOf(a, { x: -40, y: 0, w: 10, h: 10 })).toBe("left");
    expect(directionOf(a, { x: 40, y: 0, w: 10, h: 10 })).toBe("right");
  });
  it("looks up elements by id", () => {
    const w = death.pages[0].widgets.find((x) => x.kind === "dropdown")!;
    expect(getById(death, w.id)).toBe(w);
    expect(getById(death, w.options[0].id)).toBe(w.options[0]);
    expect(getById(death, "p9.s1")).toBeUndefined();
  });
});
