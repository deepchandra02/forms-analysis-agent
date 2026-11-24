/**
 * schema/refs.ts — parse and format the ID strings the model uses to "point" at things.
 *
 * WHAT:   Turns ref strings ("p1.s3-p1.s5,p1.s9", "p1.w3.o0") into structured data,
 *         and lists every ref that a PageDraft contains together with its JSON path.
 * INPUT:  ref strings; a PageDraft (for collectRefs)
 * OUTPUT: ParsedId, expanded span-ID lists, RefUse[] (one entry per ref string in the draft)
 * USED BY: src/grounding/validate.ts, src/grounding/resolve.ts, tests
 *
 * ID FORMATS are defined in src/pdf/types.ts; TextRef syntax in src/schema/draft.ts.
 */
import type { PageDraft } from "./draft.js";

/** Safety valve: a range like "p1.s1-p1.s99999" is almost certainly a model mistake. */
export const MAX_RANGE_SIZE = 500;

/** Thrown by the parse* functions when a ref string is malformed. */
export class RefError extends Error {
  constructor(
    public readonly ref: string,
    message: string,
  ) {
    super(message);
    this.name = "RefError";
  }
}

/** What an ID points at, in structured form. For options, `widget` is the widget number. */
export type ParsedId =
  | { type: "span"; page: number; index: number }
  | { type: "widget"; page: number; index: number }
  | { type: "rule"; page: number; index: number }
  | { type: "option"; page: number; widget: number; index: number };

// Numbers without leading zeros, so every thing has exactly ONE valid spelling.
const NUM = "(0|[1-9]\\d*)";
const SPAN_RE = new RegExp(`^p([1-9]\\d*)\\.s${NUM}$`);
const WIDGET_RE = new RegExp(`^p([1-9]\\d*)\\.w${NUM}$`);
const OPTION_RE = new RegExp(`^p([1-9]\\d*)\\.w${NUM}\\.o${NUM}$`);
const RULE_RE = new RegExp(`^p([1-9]\\d*)\\.r${NUM}$`);

/**
 * Parse ONE id. Throws RefError if it is not a span/widget/option/rule id.
 * Example: parseId("p1.w3.o0") → { type: "option", page: 1, widget: 3, index: 0 }
 */
export function parseId(id: string): ParsedId {
  const s = id.trim();
  let m = SPAN_RE.exec(s);
  if (m) return { type: "span", page: Number(m[1]), index: Number(m[2]) };
  m = WIDGET_RE.exec(s);
  if (m) return { type: "widget", page: Number(m[1]), index: Number(m[2]) };
  m = OPTION_RE.exec(s);
  if (m) return { type: "option", page: Number(m[1]), widget: Number(m[2]), index: Number(m[3]) };
  m = RULE_RE.exec(s);
  if (m) return { type: "rule", page: Number(m[1]), index: Number(m[2]) };
  throw new RefError(id, `"${id}" is not a valid ID (expected e.g. p1.s3, p1.w3, p1.w3.o0 or p1.r5).`);
}

/** Inverse of parseId. Example: formatId({type:"span", page:1, index:3}) → "p1.s3" */
export function formatId(id: ParsedId): string {
  switch (id.type) {
    case "span":
      return `p${id.page}.s${id.index}`;
    case "widget":
      return `p${id.page}.w${id.index}`;
    case "rule":
      return `p${id.page}.r${id.index}`;
    case "option":
      return `p${id.page}.w${id.widget}.o${id.index}`;
  }
}

/** Parse a span id for use inside a TextRef; anything else is an error. */
function parseSpanId(part: string, whole: string): Extract<ParsedId, { type: "span" }> {
  const id = parseId(part);
  if (id.type !== "span") throw new RefError(whole, `"${part}" is not a span ID; text refs may only contain spans.`);
  return id;
}

/**
 * Expand one TextRef string into the list of span IDs it covers, in order.
 * Throws RefError when malformed. Ranges must stay on one page and run forwards.
 * Example: parseTextRef("p1.s3-p1.s5,p1.s9") → ["p1.s3","p1.s4","p1.s5","p1.s9"]
 */
export function parseTextRef(ref: string): string[] {
  if (ref.trim() === "") throw new RefError(ref, "Empty ref.");
  const out: string[] = [];
  for (const rawPart of ref.split(",")) {
    const part = rawPart.trim();
    if (part === "") throw new RefError(ref, `"${ref}" has an empty entry (stray comma).`);
    const ends = part.split("-").map((e) => e.trim());
    if (ends.length > 2) throw new RefError(ref, `"${part}" is not a valid range (use "p1.s3-p1.s7").`);
    const first = parseSpanId(ends[0]!, ref);
    if (ends.length === 1) {
      out.push(formatId(first));
      continue;
    }
    const last = parseSpanId(ends[1]!, ref);
    if (first.page !== last.page) throw new RefError(ref, `Range "${part}" crosses pages.`);
    if (last.index < first.index) throw new RefError(ref, `Range "${part}" runs backwards.`);
    if (last.index - first.index + 1 > MAX_RANGE_SIZE) throw new RefError(ref, `Range "${part}" is too large.`);
    for (let n = first.index; n <= last.index; n++) out.push(formatId({ ...first, index: n }));
  }
  return out;
}

/** Non-throwing variant of parseTextRef. */
export function safeParseTextRef(ref: string): { ok: true; ids: string[] } | { ok: false; error: string } {
  try {
    return { ok: true, ids: parseTextRef(ref) };
  } catch (e) {
    if (e instanceof RefError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Where a ref string sits in the draft:
 *   "text"    a TextRef that becomes text in the Form (titles, text, labels, hints, evidence, cells)
 *   "input"   field.input — ONE widget/rule id
 *   "option"  one entry of field.options — an option id or a span id
 *   "ignored" ignored[i].refs — a TextRef whose spans are dropped on purpose
 *   "evidence" field.required_evidence — like "text", but may legitimately re-cite spans used
 *             elsewhere (typically the label that says "(mandatory field)"), so no duplicate check
 */
export type RefKind = "text" | "input" | "option" | "ignored" | "evidence";

/** One ref string found in a draft. Example path: "sections[1].items[3].field.label" */
export interface RefUse {
  path: string;
  raw: string;
  kind: RefKind;
}

/**
 * Collect EVERY ref string in a draft with its JSON path (null slots are skipped).
 * Order = document order, so error lists read top to bottom.
 */
export function collectRefs(draft: PageDraft): RefUse[] {
  const uses: RefUse[] = [];
  const add = (path: string, raw: string | null, kind: RefKind) => {
    if (raw !== null) uses.push({ path, raw, kind });
  };
  draft.sections.forEach((section, si) => {
    const sp = `sections[${si}]`;
    add(`${sp}.title`, section.title, "text");
    section.items.forEach((item, ii) => {
      const ip = `${sp}.items[${ii}]`;
      add(`${ip}.text`, item.text, "text");
      item.list_items?.forEach((r, k) => add(`${ip}.list_items[${k}]`, r, "text"));
      item.table_rows?.forEach((row, r) => row.forEach((cell, c) => add(`${ip}.table_rows[${r}][${c}]`, cell, "text")));
      if (item.field) {
        const f = item.field;
        const fp = `${ip}.field`;
        add(`${fp}.label`, f.label, "text");
        f.hints.forEach((h, k) => add(`${fp}.hints[${k}]`, h, "text"));
        add(`${fp}.input`, f.input, "input");
        f.options?.forEach((o, k) => add(`${fp}.options[${k}]`, o, "option"));
        add(`${fp}.required_evidence`, f.required_evidence, "evidence");
      }
    });
  });
  draft.ignored.forEach((ig, i) => add(`ignored[${i}].refs`, ig.refs, "ignored"));
  return uses;
}
