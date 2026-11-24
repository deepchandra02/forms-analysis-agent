/**
 * agents/input-extraction/index.ts — public API of the input-extraction agent module.
 *
 * WHAT:   The only file other code should import from this folder.
 * INPUT:  none
 * OUTPUT: the graph, the graph builder, and the input/output schemas.
 *           input  = { pdfPath }                (InputSchema)
 *           output = Form (state.form)          (FormSchema)
 * USED BY: src/cli/extract.ts, future agents / orchestrators
 *
 * PATTERN FOR FUTURE AGENTS: each agent lives in `src/agents/<name>/` and its index.ts
 * exports (1) `graph`, (2) a `build...Graph(deps)` for tests, (3) its input and output schemas.
 * Other agents then chain by passing one agent's output (e.g. the Form) as the next one's input.
 */
export { graph, buildInputExtractionGraph, InputSchema, StateSchema, MAX_ATTEMPTS } from "./graph.js";
export type { PageExtractor, DocLoader, State } from "./graph.js";
export { createInputExtractionAgent, extractPageWithAgent } from "./agent.js";
export { FormSchema as OutputSchema } from "../../schema/form.js";
export type { Form as Output } from "../../schema/form.js";
