import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PageDraftSchema } from "../src/schema/draft.js";
import { checkAzureStrict } from "../src/schema/azure-strict.js";

describe("checkAzureStrict (linter)", () => {
  it("accepts a simple strict schema (nullable via anyOf is fine)", () => {
    const s = z.object({ a: z.string(), b: z.string().nullable(), c: z.array(z.string()) }).strict();
    expect(checkAzureStrict(z.toJSONSchema(s))).toEqual([]);
  });
  it("flags missing additionalProperties:false", () => {
    const problems = checkAzureStrict({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });
    expect(problems.join()).toContain("additionalProperties");
  });
  it("flags properties missing from required", () => {
    const problems = checkAzureStrict({ type: "object", properties: { a: { type: "string" } }, required: [], additionalProperties: false });
    expect(problems.join()).toContain('"required"');
  });
  it("flags unsupported keywords", () => {
    const s = z.object({ a: z.string().min(1).max(5) }).strict();
    const p = checkAzureStrict(z.toJSONSchema(s)).join();
    expect(p).toContain("minLength");
    expect(p).toContain("maxLength");
  });
  it("flags depth > 5 object levels", () => {
    let s: z.ZodType = z.object({ v: z.string() }).strict();
    for (let i = 0; i < 5; i++) s = z.object({ n: s }).strict();
    expect(checkAzureStrict(z.toJSONSchema(s)).join()).toContain("nesting depth is 6");
  });
  it("flags more than 100 properties", () => {
    const shape = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, z.string()]));
    expect(checkAzureStrict(z.toJSONSchema(z.object(shape).strict())).join()).toContain("101 object properties");
  });
  it("flags anyOf at the root", () => {
    const p = checkAzureStrict({ anyOf: [{ type: "object" }] });
    expect(p.join()).toContain("root must not be anyOf");
  });
});

describe("PageDraftSchema", () => {
  // The model's answer schema must be accepted by Azure strict structured outputs.
  // (Note: `.int()` was removed from `page` because it emits minimum/maximum.)
  it("passes the Azure strict lint", () => {
    expect(checkAzureStrict(z.toJSONSchema(PageDraftSchema))).toEqual([]);
  });
});
