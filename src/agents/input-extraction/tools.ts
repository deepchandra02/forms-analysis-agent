/**
 * agents/input-extraction/tools.ts — the six tools the extraction agent can call.
 *
 * WHAT:   Read-only "eyes" on the extracted PDF (list_pages, read_page, get_page_rules,
 *         find_nearby, search_spans) plus one "self-check" (check_draft).
 *         Every tool gets the PdfDoc from `runtime.context.doc` (set when the agent is invoked),
 *         exactly like the SQL exercise reads `runtime.context.db`.
 * INPUT:  tool arguments from the model + runtime.context.doc
 * OUTPUT: compact text (one line per item). Problems are returned as helpful text, not thrown,
 *         so the model can correct itself.
 * USED BY: src/agents/input-extraction/agent.ts (ALL_TOOLS), tests/tools.test.ts
 *
 * Azure-strict note: every argument is REQUIRED; "optional" arguments are `nullable`.
 */
import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";
import { findNearby, getById } from "../../pdf/geometry.js";
import type { PdfDoc, PdfPage } from "../../pdf/types.js";
import { findPage } from "../../grounding/lookup.js";
import { formatReport, validatePage } from "../../grounding/validate.js";
import { resolvePage } from "../../grounding/resolve.js";
import { collapseWhitespace } from "../../grounding/normalize.js";
import { PageDraftSchema, type PageDraft } from "../../schema/draft.js";
import { formatRules, formatSpans, formatWidgets } from "./format.js";

/** What every tool can read from `runtime.context`: the extracted document. */
export const ContextSchema = z.object({
  doc: z.custom<PdfDoc>((v) => typeof v === "object" && v !== null && "pages" in v),
});
export type AgentContext = z.infer<typeof ContextSchema>;

/** The tool runtime type: context is our AgentContext. */
type Rt = ToolRuntime<unknown, AgentContext>;

/** Page lookup that returns either the page or a helpful error string. */
function getPage(runtime: Rt, page: number): PdfPage | string {
  const doc = runtime.context.doc;
  return findPage(doc, page) ?? `Page ${page} does not exist. The document has ${doc.pageCount} page(s) (1..${doc.pageCount}).`;
}

/** Lowercase + collapse whitespace, so "Last   Name" matches "last name". */
function norm(text: string): string {
  return collapseWhitespace(text).toLowerCase();
}

// ---------------------------------------------------------------------------

/** list_pages: overview of the document. */
export const listPages = tool(
  (_input, runtime: Rt) => {
    const doc = runtime.context.doc;
    const lines = doc.pages.map(
      (p) => `page ${p.page}: ${p.spans.length} spans, ${p.widgets.length} widgets, ${p.rules.length} rules`,
    );
    return [`${doc.sourceFile}: ${doc.pageCount} page(s), isAcroForm=${doc.isAcroForm}`, ...lines].join("\n");
  },
  {
    name: "list_pages",
    description:
      "Overview of the PDF: page count, whether it is an interactive form (isAcroForm=true means fill-in widgets exist; " +
      "false means a static PDF where the input boxes are drawn rules), and span/widget/rule counts per page. " +
      "Call it once at the start if you are unsure how big the document is.",
    schema: z.object({}),
  },
);

/** read_page: all spans and widgets of one page. */
export const readPage = tool(
  ({ page }, runtime: Rt) => {
    const p = getPage(runtime, page);
    if (typeof p === "string") return p;
    return [`PAGE ${p.page} (${p.width}x${p.height} pt, origin top-left, y grows downwards)`, formatSpans(p), formatWidgets(p)].join("\n");
  },
  {
    name: "read_page",
    description:
      "Read ONE page: every text span (id | text | box | font size | bold) in reading order, and every fill-in widget " +
      "(id | kind | box | options/value). This is the source of all IDs you may cite. Call it FIRST for the page you are working on. " +
      "It does not include the drawn rules; use get_page_rules for those.",
    schema: z.object({ page: z.number().describe("1-based page number") }),
  },
);

/** get_page_rules: drawn lines/boxes. */
export const getPageRules = tool(
  ({ page }, runtime: Rt) => {
    const p = getPage(runtime, page);
    if (typeof p === "string") return p;
    return formatRules(p);
  },
  {
    name: "get_page_rules",
    description:
      "List the drawn lines and boxes of one page (id | orientation | box). Use it (1) to find where a person writes on a " +
      "STATIC PDF: a horizontal rule next to or under a label is the input line, cite its rule id as `input`; " +
      "(2) to find section dividers (a long horizontal rule above a bold heading starts a new section).",
    schema: z.object({ page: z.number().describe("1-based page number") }),
  },
);

/** find_nearby: neighbours of one element. */
export const findNearbyTool = tool(
  ({ id, direction, limit }, runtime: Rt) => {
    const parsed = id.match(/^p(\d+)\./);
    if (!parsed) return `"${id}" is not a valid id. Ids look like p1.s14, p1.w3, p1.w3.o0 or p1.r5.`;
    const p = getPage(runtime, Number(parsed[1]));
    if (typeof p === "string") return p;
    if (!getById(runtime.context.doc, id)) return `Unknown id "${id}". Use read_page / get_page_rules to see the valid ids.`;
    const hits = findNearby(p, id, { direction: direction ?? "any", limit: limit ?? 6 });
    if (hits.length === 0) return `Nothing found ${direction ?? "any"} of ${id}.`;
    const lines = hits.map((h) => `${h.id} | ${h.type} | ${h.direction} | ${h.distance}pt${h.text !== undefined ? ` | ${h.text}` : ""}`);
    return [`NEAR ${id} (id | type | direction from ${id} | gap)`, ...lines].join("\n");
  },
  {
    name: "find_nearby",
    description:
      "Find the elements closest to one id (span, widget or rule), nearest first. Use it to pair a label with its input: " +
      "labels can sit ABOVE, BELOW or to the LEFT of the input, so try direction null (any) first. " +
      "Typical calls: find_nearby(widget, null, 5) to find its label; find_nearby(rule, null, 5) on static PDFs. " +
      "'direction' says where the RESULTS are relative to `id`.",
    schema: z.object({
      id: z.string().describe('The element to look around, e.g. "p1.w4" or "p1.r5".'),
      direction: z.enum(["above", "below", "left", "right", "any"]).nullable().describe("Only return elements in this direction, or null for any."),
      limit: z.number().nullable().describe("Maximum number of results, or null for the default (6)."),
    }),
  },
);

/** search_spans: find spans by text. */
export const searchSpans = tool(
  ({ text, page }, runtime: Rt) => {
    const needle = norm(text);
    if (needle === "") return "Empty search text.";
    const pages = runtime.context.doc.pages.filter((p) => page === null || p.page === page);
    const hits = pages.flatMap((p) => p.spans.filter((s) => norm(s.text).includes(needle)));
    if (hits.length === 0) return `No span contains "${text}"${page === null ? "" : ` on page ${page}`}.`;
    return [`MATCHES (${hits.length}) id | text`, ...hits.map((s) => `${s.id} | ${s.text}`)].join("\n");
  },
  {
    name: "search_spans",
    description:
      "Find spans whose text contains a string (case-insensitive, whitespace-normalized). Use it to locate helper text such as " +
      "'mandatory', 'dd.mm.yyyy' or 'Signature' without re-reading the page. Returns ids and text. `page` null = all pages.",
    schema: z.object({
      text: z.string().describe("Text to look for."),
      page: z.number().nullable().describe("1-based page to search, or null for all pages."),
    }),
  },
);

/** Preview of the resolved page: what the final Form would contain (cut if very long). */
function previewResolved(doc: PdfDoc, draft: PageDraft): string {
  const { page } = resolvePage(doc, draft);
  const json = JSON.stringify(page);
  const max = 6000;
  return json.length > max ? `${json.slice(0, max)}... (preview cut at ${max} characters)` : json;
}

/** check_draft: validate a draft, preview it if it is valid. */
export const checkDraft = tool(
  ({ draft }, runtime: Rt) => {
    const doc = runtime.context.doc;
    const report = validatePage(doc, draft);
    const text = formatReport(report);
    if (report.errors.length > 0) return `${text}\nFix the errors and call check_draft again.`;
    const preview = previewResolved(doc, draft as PageDraft);
    return `${text}\n\n0 errors. RESOLVED PREVIEW (the exact text your ids point at; read it to check it makes sense):\n${preview}\n\nIf it looks right, answer with this same draft as your final response.`;
  },
  {
    name: "check_draft",
    description:
      "Validate your PageDraft for ONE page against the PDF BEFORE you answer. Returns errors (you must fix them) and warnings, " +
      "and, when there are 0 errors, a preview of the resolved text so you can read what you built. " +
      "Always pass your complete draft; repeat until it reports 0 errors, then give the same draft as your final answer.",
    schema: z.object({ draft: PageDraftSchema }),
  },
);

/** All tools of the agent, in the order they appear in the prompt's workflow. */
export const ALL_TOOLS = [listPages, readPage, getPageRules, findNearbyTool, searchSpans, checkDraft];
