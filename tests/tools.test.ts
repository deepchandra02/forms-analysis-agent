/**
 * tests/tools.test.ts — the six agent tools, invoked directly (no model).
 * Context is passed the way createAgent would: config.context = { doc }.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { extractPdf } from "../src/pdf/extract.js";
import type { PdfDoc } from "../src/pdf/types.js";
import {
  ALL_TOOLS, checkDraft, findNearbyTool, getPageRules, listPages, readPage, searchSpans,
} from "../src/agents/input-extraction/tools.js";
import { makeDoc, makeValidDraft } from "./fixtures/synthetic-doc.js";

const synth = { context: { doc: makeDoc() } };
let real: { context: { doc: PdfDoc } };

beforeAll(async () => {
  real = { context: { doc: await extractPdf("sample-forms/event-of-death-en.pdf") } };
});

describe("tools", () => {
  it("exports six tools", () => {
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([
      "list_pages", "read_page", "get_page_rules", "find_nearby", "search_spans", "check_draft",
    ]);
  });

  it("list_pages gives counts", async () => {
    const out = await listPages.invoke({}, synth as never);
    expect(out).toContain("1 page(s), isAcroForm=true");
    expect(out).toContain("page 1: 8 spans, 2 widgets, 2 rules");
  });

  it("read_page lists spans and widgets (real doc)", async () => {
    const out = await readPage.invoke({ page: 1 }, real as never);
    expect(out).toContain("p1.s29 | Last name | x=49.6 y=524.2 w=34.6 h=8 | 8pt");
    expect(out).toContain("p1.w11 | dropdown");
    expect(out).toContain("p1.w11.o1=Single");
  });

  it("read_page on a missing page explains the valid range", async () => {
    expect(await readPage.invoke({ page: 9 }, synth as never)).toContain("does not exist");
  });

  it("get_page_rules lists rules", async () => {
    const out = await getPageRules.invoke({ page: 1 }, real as never);
    expect(out).toContain("p1.r5 | horizontal");
  });

  it("find_nearby finds the label below a dropdown (real doc)", async () => {
    const out = await findNearbyTool.invoke({ id: "p1.w11", direction: "below", limit: 5 }, real as never);
    expect(out).toContain("p1.s36");
    expect(out).toContain("Marital status");
  });

  it("find_nearby accepts null direction/limit and rejects unknown ids helpfully", async () => {
    expect(await findNearbyTool.invoke({ id: "p1.w1", direction: null, limit: null }, synth as never)).toContain("NEAR p1.w1");
    expect(await findNearbyTool.invoke({ id: "p1.w99", direction: null, limit: null }, synth as never)).toContain("Unknown id");
  });

  it("search_spans is case-insensitive and whitespace-normalized (real doc)", async () => {
    const out = await searchSpans.invoke({ text: "MANDATORY  field", page: null }, real as never);
    expect(out).toContain("p1.s37");
  });

  it("search_spans reports no match", async () => {
    expect(await searchSpans.invoke({ text: "zzz", page: 1 }, synth as never)).toContain("No span contains");
  });

  it("check_draft accepts a valid draft and previews it", async () => {
    const out = await checkDraft.invoke({ draft: makeValidDraft() }, synth as never);
    expect(out).toContain("0 errors");
    expect(out).toContain("RESOLVED PREVIEW");
    expect(out).toContain("Last name");
  });

  it("check_draft lists error codes for a broken draft", async () => {
    const draft = makeValidDraft();
    draft.ignored = []; // p1.s8 is now unaccounted
    const out = await checkDraft.invoke({ draft }, synth as never);
    expect(out).toContain("E_UNACCOUNTED_SPAN");
    expect(out).not.toContain("RESOLVED PREVIEW");
  });
});
