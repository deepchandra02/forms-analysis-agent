/**
 * grounding/report.ts — the shape of validator output.
 *
 * WHAT:   Types only: an Issue (one problem), a PageReport (all problems of one page),
 *         and the fixed list of codes. Codes are a closed vocabulary so the agent prompt,
 *         tests and later review UI can rely on them.
 * INPUT:  none
 * OUTPUT: Issue, PageReport, IssueCode, ERROR_CODES, WARNING_CODES
 * USED BY: src/grounding/validate.ts, src/grounding/resolve.ts, the agent's check_draft tool
 */

/** Blocking problems: the draft must be fixed before it is accepted. */
export const ERROR_CODES = [
  "E_SCHEMA",
  "E_BAD_REF",
  "E_UNKNOWN_REF",
  "E_WRONG_PAGE_REF",
  "E_DUPLICATE_REF",
  "E_UNACCOUNTED_SPAN",
  "E_UNUSED_WIDGET",
  "E_WIDGET_TYPE_MISMATCH",
  "E_OPTIONS_MISMATCH",
  "E_KIND_SHAPE",
  "E_REQUIRED_NO_EVIDENCE",
  "E_WRONG_REF_TYPE",
] as const;

/** Non-blocking: interpretive choices a human may want to look at. */
export const WARNING_CODES = [
  "W_TYPE_INFERRED",
  "W_NO_INPUT",
  "W_LABEL_FAR_FROM_INPUT",
  "W_NORMALIZED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type WarningCode = (typeof WARNING_CODES)[number];
export type IssueCode = ErrorCode | WarningCode;

/** One problem. `path` is a JSON path into the draft, e.g. "sections[1].items[3].field.label". */
export interface Issue {
  code: IssueCode;
  path: string;
  /** Short, actionable text the LLM can act on. */
  message: string;
  /** The IDs involved, when that helps (e.g. the unaccounted span). */
  refs?: string[];
}

export interface PageReport {
  page: number;
  errors: Issue[];
  warnings: Issue[];
}
