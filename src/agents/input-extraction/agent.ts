/**
 * agents/input-extraction/agent.ts — the tool-using agent that drafts ONE page.
 *
 * WHAT:   createAgent(model + 6 tools + system prompt + structured output = PageDraft).
 *         The PdfDoc is passed per call as `context.doc` (tools read it from there).
 * INPUT:  a chat model (default: Azure via getChatModel()), a PdfDoc, a page number
 * OUTPUT: a PageDraft (validated against PageDraftSchema by LangChain)
 * USED BY: src/agents/input-extraction/graph.ts (via extractPageWithAgent)
 */
import { createAgent, providerStrategy, HumanMessage } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getChatModel } from "../../config/model.js";
import type { PdfDoc } from "../../pdf/types.js";
import { PageDraftSchema, type PageDraft } from "../../schema/draft.js";
import { SYSTEM_PROMPT, buildPageMessage } from "./prompt.js";
import { ALL_TOOLS, ContextSchema } from "./tools.js";

/**
 * Structured-output strategy: providerStrategy (native `response_format` JSON schema, strict).
 *
 * WHY: PageDraftSchema is already written to Azure's strict structured-output rules
 *      (all fields required, nullable instead of optional, shallow nesting), so the API can
 *      FORCE the final answer to match the schema; no "model forgot a field" retries.
 *      The agent can call tools freely, and only its final message is schema-constrained.
 *
 * THE ONE KNOB: if Azure rejects tools + response_format together (older api-version or
 *      deployment) or the schema is refused, replace the line below with
 *      `toolStrategy(PageDraftSchema)`. That makes the final answer a tool call instead,
 *      which works on any tool-calling model. Nothing else in the project changes.
 */
export const RESPONSE_FORMAT = providerStrategy({ schema: PageDraftSchema, strict: true });

/** The agent type: kept inferred so structuredResponse stays typed. */
export function createInputExtractionAgent(model: BaseChatModel = getChatModel()) {
  return createAgent({
    model,
    tools: ALL_TOOLS,
    systemPrompt: SYSTEM_PROMPT,
    contextSchema: ContextSchema,
    responseFormat: RESPONSE_FORMAT,
  });
}

export type InputExtractionAgent = ReturnType<typeof createInputExtractionAgent>;

/**
 * Run the agent for one page and return its PageDraft.
 * `feedback` = validator report of a failed earlier attempt, or null.
 * Example: const draft = await extractPageWithAgent(agent, doc, 1, null);
 */
export async function extractPageWithAgent(
  agent: InputExtractionAgent,
  doc: PdfDoc,
  page: number,
  feedback: string | null,
): Promise<PageDraft> {
  const result = await agent.invoke(
    { messages: [new HumanMessage(buildPageMessage(page, feedback))] },
    { context: { doc }, recursionLimit: 60 },
  );
  return PageDraftSchema.parse(result.structuredResponse);
}
