/**
 * tests/graph.test.ts — the LangGraph workflow with a stub extractor and the synthetic doc.
 * No network, no real PDF.
 */
import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, buildInputExtractionGraph, graph, type PageExtractor } from "../src/agents/input-extraction/graph.js";
import type { PageDraft } from "../src/schema/draft.js";
import { makeDoc, makeValidDraft } from "./fixtures/synthetic-doc.js";

const loadDoc = async () => makeDoc();

/** A draft with one error (p1.s8 unaccounted). */
function makeBrokenDraft(): PageDraft {
  const d = makeValidDraft();
  d.ignored = [];
  return d;
}

/** Stub that returns drafts from a list (last one repeats) and records its calls. */
function scripted(drafts: PageDraft[]) {
  const calls: { page: number; feedback: string | null }[] = [];
  const extractor: PageExtractor = async (_doc, page, feedback) => {
    calls.push({ page, feedback });
    return drafts[Math.min(calls.length - 1, drafts.length - 1)]!;
  };
  return { extractor, calls };
}

describe("input-extraction graph", () => {
  it("produces a Form when the first draft is valid", async () => {
    const { extractor, calls } = scripted([makeValidDraft()]);
    const result = await buildInputExtractionGraph({ pageExtractor: extractor, loadDoc }).invoke({ pdfPath: "x.pdf" });
    expect(calls).toHaveLength(1);
    expect(result.statuses).toEqual({ "1": "ok" });
    expect(result.form?.pages[0]?.status).toBe("ok");
    expect(JSON.stringify(result.form)).toContain("Last name");
  });

  it("retries with validator feedback, then succeeds", async () => {
    const { extractor, calls } = scripted([makeBrokenDraft(), makeValidDraft()]);
    const result = await buildInputExtractionGraph({ pageExtractor: extractor, loadDoc }).invoke({ pdfPath: "x.pdf" });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.feedback).toBeNull();
    expect(calls[1]!.feedback).toContain("E_UNACCOUNTED_SPAN");
    expect(result.statuses["1"]).toBe("ok");
    expect(result.form?.pages[0]?.sections.length).toBeGreaterThan(0);
  });

  it("marks the page failed after MAX_ATTEMPTS and still completes", async () => {
    const { extractor, calls } = scripted([makeBrokenDraft()]);
    const result = await buildInputExtractionGraph({ pageExtractor: extractor, loadDoc }).invoke({ pdfPath: "x.pdf" });
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(result.statuses["1"]).toBe("failed");
    expect(result.form?.pages[0]?.status).toBe("failed");
    expect(result.review.some((r) => r.code === "E_UNACCOUNTED_SPAN")).toBe(true);
  });

  it("treats an extractor crash as a failed attempt", async () => {
    let n = 0;
    const extractor: PageExtractor = async () => {
      if (n++ === 0) throw new Error("boom");
      return makeValidDraft();
    };
    const result = await buildInputExtractionGraph({ pageExtractor: extractor, loadDoc }).invoke({ pdfPath: "x.pdf" });
    expect(result.statuses["1"]).toBe("ok");
  });

  it("importing the module and the default graph needs no env vars", () => {
    expect(graph).toBeDefined();
  });
});
