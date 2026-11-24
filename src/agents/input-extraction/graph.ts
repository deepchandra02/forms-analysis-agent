/**
 * agents/input-extraction/graph.ts — the LangGraph workflow: PDF in, grounded Form out.
 *
 * WHAT:   START -> extract_pdf -> extract_page -> validate_page --(errors, attempts < 3)--> extract_page
 *                                                      |--(next page)--> extract_page
 *                                                      '--(last page)--> assemble -> END
 *         One page at a time. The model call lives behind a `PageExtractor` function so tests
 *         can inject a stub (no network). Style follows the L2 email workflow exercise:
 *         zod state + nodes that return Command({ update, goto }).
 * INPUT:  { pdfPath }
 * OUTPUT: state with `form` (the final Form), `review` (things a human should look at),
 *         plus drafts / reports / statuses per page for debugging.
 * USED BY: src/cli/extract.ts, langgraph.json, tests/graph.test.ts
 *
 * Later improvement: process pages in parallel with `Send` (one extract_page per page).
 * Sequential is simpler to follow and keeps `continues_previous_page` decisions ordered.
 */
import { Command, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { formatReport, validatePage } from "../../grounding/validate.js";
import type { PageReport } from "../../grounding/report.js";
import { resolveForm } from "../../grounding/resolve.js";
import { extractPdf } from "../../pdf/extract.js";
import type { PdfDoc } from "../../pdf/types.js";
import { PageDraftSchema, type PageDraft } from "../../schema/draft.js";
import { FormSchema, type Form, type ReviewItem } from "../../schema/form.js";
import { createInputExtractionAgent, extractPageWithAgent, type InputExtractionAgent } from "./agent.js";

/** Each page gets this many tries (1 first attempt + retries with validator feedback). */
export const MAX_ATTEMPTS = 3;

/** Asks "some model" for one page's draft. `feedback` = validator report of the last failed try, or null. */
export type PageExtractor = (doc: PdfDoc, page: number, feedback: string | null) => Promise<PageDraft>;

/** Turns a path into a PdfDoc. Injectable so tests can use a hand-built doc. */
export type DocLoader = (pdfPath: string) => Promise<PdfDoc>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const PdfDocSchema = z.custom<PdfDoc>((v) => typeof v === "object" && v !== null && "pages" in v);
const PageReportSchema = z.custom<PageReport>((v) => typeof v === "object" && v !== null && "errors" in v);
const ReviewItemSchema = z.custom<ReviewItem>((v) => typeof v === "object" && v !== null && "code" in v);

/** Input of the graph: only the PDF path. */
export const InputSchema = z.object({ pdfPath: z.string() });

/** Whole graph state. Records are keyed by page number (as a string). */
export const StateSchema = z.object({
  pdfPath: z.string(),
  doc: PdfDocSchema.nullable().default(null),
  currentPage: z.number().default(1),
  attempts: z.number().default(0),
  feedback: z.string().nullable().default(null),
  /** The newest answer of the extractor, before validation (null if the extractor crashed). */
  pendingDraft: z.unknown().default(null),
  drafts: z.record(z.string(), PageDraftSchema).default({}),
  reports: z.record(z.string(), PageReportSchema).default({}),
  statuses: z.record(z.string(), z.enum(["ok", "failed"])).default({}),
  form: FormSchema.nullable().default(null),
  review: z.array(ReviewItemSchema).default([]),
});
export type State = z.infer<typeof StateSchema>;

// ---------------------------------------------------------------------------
// Nodes (built with the injected dependencies)
// ---------------------------------------------------------------------------

/** extract_pdf: path -> PdfDoc; reset the per-page counters. */
function makeExtractPdfNode(loadDoc: DocLoader) {
  return async (state: State) => {
    const doc = await loadDoc(state.pdfPath);
    return { doc, currentPage: 1, attempts: 0, feedback: null };
  };
}

/** extract_page: ask the extractor for the current page. A crash counts as a failed attempt. */
function makeExtractPageNode(pageExtractor: PageExtractor) {
  return async (state: State) => {
    const attempts = state.attempts + 1;
    try {
      const pendingDraft = await pageExtractor(state.doc!, state.currentPage, state.feedback);
      return { attempts, pendingDraft };
    } catch (e) {
      // WHY not rethrow: one bad page must not lose the other pages. validate_page turns
      // the null draft into an E_SCHEMA error and the page is retried / marked failed.
      console.warn(`extract_page: page ${state.currentPage} attempt ${attempts} crashed: ${(e as Error).message}`);
      return { attempts, pendingDraft: null };
    }
  };
}

/**
 * validate_page: run the validator, then route.
 *   errors and attempts left -> extract_page again (with the report as feedback)
 *   otherwise -> record the result, go to the next page or to assemble
 */
async function validatePageNode(state: State) {
  const doc = state.doc!;
  const key = String(state.currentPage);
  const report = validatePage(doc, state.pendingDraft);
  const failed = report.errors.length > 0;

  if (failed && state.attempts < MAX_ATTEMPTS) {
    return new Command({ update: { feedback: formatReport(report) }, goto: "extract_page" });
  }

  const parsed = PageDraftSchema.safeParse(state.pendingDraft);
  const update = {
    drafts: parsed.success ? { ...state.drafts, [key]: parsed.data } : state.drafts,
    reports: { ...state.reports, [key]: report },
    statuses: { ...state.statuses, [key]: failed ? ("failed" as const) : ("ok" as const) },
    pendingDraft: null,
    attempts: 0,
    feedback: null,
  };
  const isLastPage = state.currentPage >= doc.pageCount;
  if (isLastPage) return new Command({ update, goto: "assemble" });
  return new Command({ update: { ...update, currentPage: state.currentPage + 1 }, goto: "extract_page" });
}

/** assemble: resolve all drafts into the Form and build the human review list. */
function assembleNode(state: State) {
  const doc = state.doc!;
  const results: Record<number, { draft: PageDraft | null; status: "ok" | "failed" }> = {};
  for (const p of doc.pages) {
    const key = String(p.page);
    results[p.page] = { draft: state.drafts[key] ?? null, status: state.statuses[key] ?? "failed" };
  }
  const form: Form = resolveForm(doc, results);
  return { form, review: buildReview(state) };
}

/** Every warning, plus every error of a failed page, as a ReviewItem. */
function buildReview(state: State): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const report of Object.values(state.reports)) {
    const status = state.statuses[String(report.page)];
    const issues = status === "failed" ? [...report.errors, ...report.warnings] : report.warnings;
    for (const i of issues) items.push({ code: i.code, page: report.page, path: i.path, message: i.message });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/**
 * Build the graph. Dependencies are injected so tests never touch a model or a real PDF.
 * Example: buildInputExtractionGraph({ pageExtractor: async () => draft, loadDoc: async () => doc })
 */
export function buildInputExtractionGraph(deps: { pageExtractor: PageExtractor; loadDoc?: DocLoader }) {
  return new StateGraph({ state: StateSchema, input: InputSchema })
    .addNode("extract_pdf", makeExtractPdfNode(deps.loadDoc ?? extractPdf))
    .addNode("extract_page", makeExtractPageNode(deps.pageExtractor))
    .addNode("validate_page", validatePageNode, { ends: ["extract_page", "assemble"] })
    .addNode("assemble", assembleNode)
    .addEdge(START, "extract_pdf")
    .addEdge("extract_pdf", "extract_page")
    .addEdge("extract_page", "validate_page")
    .addEdge("assemble", END)
    .compile();
}

/**
 * The real extractor: creates the agent (and therefore the Azure model) on FIRST USE.
 * WHY lazy: importing this module (langgraph dev, tests) must not need env vars.
 */
function makeLazyAgentExtractor(): PageExtractor {
  let agent: InputExtractionAgent | null = null;
  return async (doc, page, feedback) => {
    agent ??= createInputExtractionAgent();
    return extractPageWithAgent(agent, doc, page, feedback);
  };
}

/** The graph used by langgraph.json and src/cli/extract.ts. */
export const graph = buildInputExtractionGraph({ pageExtractor: makeLazyAgentExtractor() });
