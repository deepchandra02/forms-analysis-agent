/**
 * config/model.ts — the ONE place that knows which AI provider we use.
 *
 * WHAT:   Builds the chat model used by every agent. Today that is Azure OpenAI.
 *         To switch provider (e.g. plain OpenAI for local experiments), change only this file.
 * INPUT:  environment variables (see .env.example):
 *           AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY,
 *           AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
 * OUTPUT: a LangChain chat model (AzureChatOpenAI)
 * USED BY: src/agents/<agent>/agent.ts
 *
 * Nothing here runs a model call. The model is only called when an agent is invoked.
 */
import "dotenv/config";
import { AzureChatOpenAI } from "@langchain/openai";

/** Reads a required environment variable, with a clear error if it is missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Returns the chat model for our agents.
 *
 * Settings and why:
 * - `parallel_tool_calls: false`: Azure's docs say structured outputs (our responseFormat)
 *   are not supported together with parallel tool calls. One tool call at a time also
 *   keeps the agent's reasoning easy to follow in traces.
 * - No `temperature`: reasoning models (gpt-5 family) reject it. If your deployment is a
 *   non-reasoning model, you may add `temperature: 0` for more repeatable output.
 *
 * @example
 *   const model = getChatModel();
 *   const agent = createAgent({ model, tools, systemPrompt });
 */
export function getChatModel(): AzureChatOpenAI {
  return new AzureChatOpenAI({
    azureOpenAIEndpoint: requireEnv("AZURE_OPENAI_ENDPOINT"),
    azureOpenAIApiKey: requireEnv("AZURE_OPENAI_API_KEY"),
    azureOpenAIApiDeploymentName: requireEnv("AZURE_OPENAI_DEPLOYMENT"),
    azureOpenAIApiVersion: requireEnv("AZURE_OPENAI_API_VERSION"),
    modelKwargs: { parallel_tool_calls: false },
  });
}
