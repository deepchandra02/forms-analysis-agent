/**
 * tests/fixtures/synthetic-doc.ts — a tiny hand-built PdfDoc + a matching valid PageDraft.
 *
 * WHAT:   One page, 8 spans, 2 widgets (text, dropdown with 2 options), 2 rules.
 *         Built by hand (no extractor) so grounding tests are independent of src/pdf.
 * INPUT:  none
 * OUTPUT: makeDoc(), makeValidDraft()  (both return fresh objects, safe to mutate)
 * USED BY: tests/validate.test.ts, tests/resolve.test.ts
 */
import type { PdfDoc, Span } from "../../src/pdf/types.js";
import type { FieldType, PageDraft } from "../../src/schema/draft.js";

function span(n: number, text: string, line: number, x: number, y: number, w = 60): Span {
  return {
    id: `p1.s${n}`, page: 1, text, box: { x, y, w, h: 12 }, fontSize: 10, bold: false,
    line, source: "text", widgetId: null,
  };
}

/** Fresh synthetic document. */
export function makeDoc(): PdfDoc {
  return {
    sourceFile: "synthetic.pdf",
    pageCount: 1,
    isAcroForm: true,
    pages: [
      {
        page: 1,
        width: 595,
        height: 842,
        spans: [
          span(1, "Application Form", 0, 50, 40, 200),
          span(2, "Please fill in all fields.", 1, 50, 70, 200),
          span(3, "Last name", 2, 50, 100),
          span(4, "(mandatory field)", 2, 50, 112, 90),
          span(5, "Country", 3, 50, 130),
          span(6, "Signature", 4, 50, 200),
          span(7, "Date", 5, 50, 240),
          span(8, "Page 1/3", 6, 250, 800),
        ],
        widgets: [
          { id: "p1.w1", page: 1, kind: "text", box: { x: 120, y: 98, w: 150, h: 16 }, multiline: false, options: [], value: null, valueSpanId: null },
          {
            id: "p1.w2", page: 1, kind: "dropdown", box: { x: 120, y: 128, w: 150, h: 16 }, multiline: false,
            options: [{ id: "p1.w2.o0", text: "Germany" }, { id: "p1.w2.o1", text: "France" }],
            value: null, valueSpanId: null,
          },
        ],
        rules: [
          { id: "p1.r1", page: 1, box: { x: 120, y: 212, w: 200, h: 1 }, orientation: "horizontal" },
          { id: "p1.r2", page: 1, box: { x: 120, y: 252, w: 100, h: 1 }, orientation: "horizontal" },
        ],
      },
    ],
  };
}

/** A draft that passes validation for makeDoc() with 0 errors. */
export function makeValidDraft(): PageDraft {
  const field = (label: string, field_type: FieldType, input: string | null, extra: object = {}) => ({
    kind: "field" as const, text: null, list_items: null, table_rows: null,
    field: { label, field_type, input, hints: [], options: null, required: false, required_evidence: null, ...extra },
  });
  return {
    page: 1,
    sections: [
      {
        region: "body",
        title: "p1.s1",
        continues_previous_page: false,
        items: [
          { kind: "paragraph", text: "p1.s2", list_items: null, table_rows: null, field: null },
          field("p1.s3", "text", "p1.w1", { required: true, required_evidence: "p1.s4" }),
          field("p1.s5", "dropdown", "p1.w2", { options: ["p1.w2.o0", "p1.w2.o1"] }),
          field("p1.s6", "signature", "p1.r1"),
          field("p1.s7", "date", "p1.r2"),
        ],
      },
    ],
    ignored: [{ refs: "p1.s8", reason: "page_number" }],
  };
}
