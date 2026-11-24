/**
 * tests/agent.test.ts — createAgent wiring with a scripted fake model (no network).
 * Proves: tools receive context.doc, the final answer is parsed into `structuredResponse`.
 */
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { createInputExtractionAgent, extractPageWithAgent } from "../src/agents/input-extraction/agent.js";
import { makeDoc, makeValidDraft } from "./fixtures/synthetic-doc.js";

describe("input-extraction agent", () => {
  it("runs tools with context and returns the structured draft", async () => {
    const draft = makeValidDraft();
    const model = fakeModel()
      .respondWithTools([{ name: "read_page", args: { page: 1 }, id: "c1" }])
      .respondWithTools([{ name: "check_draft", args: { draft }, id: "c2" }])
      .respond(new AIMessage(JSON.stringify(draft)));

    const agent = createInputExtractionAgent(model as never);
    const result = await extractPageWithAgent(agent, makeDoc(), 1, null);

    expect(result).toEqual(draft);
    // the second model call saw the read_page output (tools got the doc from context)
    const seen = JSON.stringify(model.calls[1]!.messages.map((m) => m.content));
    expect(seen).toContain("p1.s3 | Last name");
    // the third saw check_draft's verdict
    expect(JSON.stringify(model.calls[2]!.messages.map((m) => m.content))).toContain("0 errors");
  });
});
