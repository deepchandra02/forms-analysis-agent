# Handoff: input-extraction agent skeleton

**Branch:** `skeletal-framework` · **Status:** the deterministic parts are built and tested. The agent has **never been run against a real model**, because no credentials existed during development.
**Plain-language overview:** [technical-flow.md](technical-flow.md) explains the flow with diagrams, for non-technical readers. This file is for the developer who continues the work.

---

## 1. What exists

The first of several modular forms-analysis agents. It reads a PDF form (text layer always present; static or AcroForm) and outputs JSON describing what is **rendered**: sections, paragraphs, lists, tables, and fields with their types and options.

**Core design: grounding by reference.** The model never types form text. A script tags everything on the page:

| Tag | Meaning | Example |
|---|---|---|
| `p1.s29` | span | "Last name" |
| `p1.w4` | widget | a fill-in box |
| `p1.w11.o1` | dropdown option | "Single" |
| `p1.r5` | drawn line | an underline |

The model answers only with tags (a `PageDraft`). The validator then rejects the draft if:
- a ref is unknown or belongs to another page,
- a span is cited twice,
- a span is neither cited nor explicitly ignored with a reason (**coverage**),
- a widget is unused,
- a field type contradicts its widget,
- dropdown options differ from the PDF's,
- `required` has no evidence span.

The resolver then copies the exact PDF text into the final `Form` JSON.

```
START → extract_pdf → extract_page (agent, 1 page) → validate_page ─┬─ errors & attempts<3 → extract_page (with feedback)
                                                                    ├─ next page          → extract_page
                                                                    └─ done               → assemble → END
```

## 2. How to run

```bash
npm install
npm test                                   # 113 tests, no network, no model
npm run typecheck
npm run dump -- sample-forms/event-of-death-en.pdf 1     # what the model "sees" for page 1 (no model)

cp .env.example .env                       # fill AZURE_OPENAI_ENDPOINT / _API_KEY / _DEPLOYMENT / _API_VERSION
npm run extract -- sample-forms/event-of-death-en.pdf    # REAL run → out/<name>.form.json, .drafts.json, .report.json
npm run dev                                # LangGraph Studio (langgraph.json → input-extraction graph)
```

The stack is Node 22+ (developed on 26), TypeScript ESM, zod v4, langchain 1.6, @langchain/langgraph 1.7, @langchain/openai 1.8 and pdfjs-dist 6.5.438. pdfjs-dist is pinned exactly because `graphics.ts` parses its internal `constructPath` format. npm is used because pnpm wasn't installed.

## 3. Code map

| Path | Job |
|---|---|
| `src/pdf/types.ts` | **Contract**: `PdfDoc → PdfPage → Span / Widget / Rule`, ID formats, coordinates (pt, top-left origin) |
| `src/pdf/{load,lines,widgets,graphics,geometry,extract}.ts` | pdf.js → tagged doc. `lines.ts` = span grouping, `widgets.ts` = AcroForm fields (no internal names, ever), `graphics.ts` = rules, `geometry.ts` = `findNearby` / `getById` |
| `src/schema/draft.ts` | `PageDraftSchema`: the model's answer, written to Azure strict rules (all required, nullable, depth ≤ 5, no min/max/pattern) |
| `src/schema/form.ts` | `FormSchema`: the final output with fixed keys (discriminated union on `kind`). Later agents consume it |
| `src/schema/refs.ts` | TextRef parsing (`"p1.s3-p1.s7,p1.s9"`), `collectRefs` |
| `src/schema/azure-strict.ts` | Lint that a JSON schema satisfies Azure strict-mode limits |
| `src/grounding/validate.ts` | Validator: error codes `E_*` block, warning codes `W_*` go to human review |
| `src/grounding/{resolve,normalize,lookup,report}.ts` | Refs → text, using three narrow normalization rules (whitespace, line-end de-hyphenation, ligatures) |
| `src/agents/input-extraction/tools.ts` | 6 tools: `list_pages`, `read_page`, `get_page_rules`, `find_nearby`, `search_spans`, `check_draft`. They read `runtime.context.doc` |
| `src/agents/input-extraction/prompt.ts` | System prompt (rules mirror the validator codes, with a worked example built from real page-1 output) |
| `src/agents/input-extraction/agent.ts` | `createAgent({ model, tools, systemPrompt, contextSchema, responseFormat })` and **`RESPONSE_FORMAT` knob** |
| `src/agents/input-extraction/graph.ts` | StateGraph with dependency injection: `buildInputExtractionGraph({ pageExtractor, loadDoc? })`. `graph` creates the real agent lazily, so importing it needs no env vars |
| `src/config/model.ts` | `getChatModel()`: **the only provider-specific file** (AzureChatOpenAI, `parallel_tool_calls: false`) |
| `src/cli/{dump-page,extract}.ts` | Manual commands |
| `tests/fixtures/event-of-death.draft.json` | **Golden draft**: a hand-written perfect answer for all 3 pages. Its resolved form is `event-of-death.form.json`; regenerate it with `UPDATE_GOLDEN=1 npx vitest run tests/golden.test.ts` |

## 4. What is verified (no model calls)

- **PDF extraction** on both sample PDFs: span splits, footnote markers, the pre-filled widget value (p3 "Complete and print out this page…"), the 7 Marital-status options, rules, ID uniqueness, and no leaks of internal field names.
- **Golden draft:** 0 errors on every page. The resolved Form equals the saved fixture.
- **Mutations:** each error code fires on a deliberately broken golden draft.
- **Azure-strict lint** of `PageDraftSchema` passes. `.int()` was removed from `page` because it emits `minimum`/`maximum`.
- **Tools:** each tool was called directly against the synthetic doc and the real doc.
- **Graph:** the happy path, retry-then-succeed (feedback carries the error codes), and always-fail (the page is marked `failed` and the run still completes).
- **Agent loop:** run with `fakeModel()` through `read_page` → `check_draft` → structured answer. This proves the tools receive context and that `structuredResponse` is parsed.

## 5. To verify first in the real Azure environment

1. **`responseFormat` with tools.** `agent.ts` uses `providerStrategy({ schema: PageDraftSchema, strict: true })`. If the deployment or API version rejects `response_format` combined with tools or with this schema, switch `RESPONSE_FORMAT` to `toolStrategy(PageDraftSchema)`. That one line is the change.
2. **`parallel_tool_calls: false`** is passed through `modelKwargs` in `config/model.ts`. Confirm it reaches the request; LangSmith tracing helps.
3. **Large tool arguments.** `check_draft` receives the whole page draft. Watch for truncated or invalid arguments on dense pages.
4. **Recursion limit.** It is 60 per page in `agent.ts`. Check this is enough, and that the model stops once `check_draft` reports 0 errors.
5. **Quality.** Compare `out/event-of-death-en.form.json` from a real run with `tests/fixtures/event-of-death.form.json`; the golden fixture is the target. The warnings in `report.json` are the human-review list.
6. **Temperature.** None is set, because reasoning models reject it. For a non-reasoning deployment, consider `temperature: 0`.

## 6. Design decisions worth knowing

- **One page per agent run.** This keeps context small and stays within Azure's limit of 5 schema nesting levels. Pages run sequentially; fan-out with `Send` is a later improvement.
- **TextRef is a string** (`"p1.s3-p1.s7"`) rather than an array. This saves a nesting level.
- **Rendered only.** Internal AcroForm field names are never extracted. Visible widget values and dropdown option lists **are** included, at the user's request.
- **A label shared by several boxes.** For example, "Banking relationship" sits over two widgets. This becomes two fields that repeat the same label span. The validator allows a span to repeat *only* across `field.label` slots. **Open question:** the alternative is a field `input` that can list several widgets; we haven't decided yet.
- **`required_evidence` may re-cite a span.** For example, the AHV label itself contains "(mandatory field)".
- **A pre-filled widget is accounted for by citing its value span.** It doesn't need to be a field input.
- **Labels on the UBS forms are printed *below* their line or box.** The prompt says labels can sit above, below or left, and that the model should measure with `find_nearby`.
- **Normalization is deliberately narrow.** A loose rule could hide a real mistake. Every time a rule fires, a `W_NORMALIZED` warning is recorded.

## 7. Known limitations and next steps

- **Static (non-AcroForm) PDFs** have only been unit-tested synthetically. Both sample forms are AcroForms. Add a static sample and a golden draft for it.
- **Only one golden draft so far.** The fisca transfer form has no golden draft yet; adding one would broaden the regression net.
- **Page 2 of event-of-death has a stray widget.** `p2.w4` sits inside the "Please ensure…" paragraph. The golden draft maps it to "Number of existing beneficiaries" (29pt away, no warning).
- **Failed pages are not reviewed by a person yet.** A page that is still failing after 3 attempts is marked `failed` and skipped. A LangGraph `interrupt` for a human-in-the-loop fix is a natural next step (see `docs/langgraph-exercises/js/src/L1/05-interrupts.ts`).
- **Pattern for the next agents:** `src/agents/<name>/` exporting `graph` plus its input and output zod schemas, and taking `Form` as input.

## 8. Conventions (please keep)

- **Modular, simple, well commented.** Every file has a header (WHAT / INPUT / OUTPUT / USED BY), and every exported function has a doc comment.
- **Keep `technical-flow.md` in sync** with any change to the flow. It is written for non-technical readers.
- **No model calls in tests.** Use stub extractors or `fakeModel()`.
