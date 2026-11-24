/**
 * schema/azure-strict.ts — a linter for "Azure OpenAI strict structured output" JSON Schemas.
 *
 * WHAT:   Walks a JSON Schema and reports everything Azure strict mode would reject.
 *         Run it in a test on z.toJSONSchema(PageDraftSchema) so a schema edit that breaks
 *         Azure fails CI, not production.
 * INPUT:  a JSON Schema object (e.g. z.toJSONSchema(schema))
 * OUTPUT: string[] of problems (empty = OK)
 * USED BY: tests/azure-strict.test.ts
 *
 * RULES CHECKED
 *   - every object: additionalProperties === false, and ALL properties listed in `required`
 *   - nesting: at most MAX_OBJECT_DEPTH object levels. DEPTH COUNTING: the root object is
 *     level 1; an object inside it (through properties / arrays / anyOf) is level 2, etc.
 *     Arrays, anyOf and $ref do not add a level by themselves, only objects do. This is the
 *     conservative reading of Azure's "up to five levels of nesting".
 *   - at most MAX_PROPERTIES properties in total over all objects
 *   - none of the unsupported keywords (UNSUPPORTED_KEYWORDS)
 *   - the root must be an object, not anyOf
 */

export const MAX_OBJECT_DEPTH = 5;
export const MAX_PROPERTIES = 100;
export const UNSUPPORTED_KEYWORDS = [
  "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "multipleOf",
  "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties",
  "unevaluatedItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems",
] as const;

type Schema = Record<string, unknown>;

const isSchema = (v: unknown): v is Schema => typeof v === "object" && v !== null && !Array.isArray(v);

/** Accumulated state while walking. */
interface State {
  root: Schema;
  problems: string[];
  propertyCount: number;
  maxDepth: number;
}

/** Follow a local "#/$defs/x" ref; anything else is left as is. */
function deref(node: Schema, root: Schema): Schema {
  const ref = node["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  let cur: unknown = root;
  for (const key of ref.slice(2).split("/")) cur = isSchema(cur) ? cur[key] : undefined;
  return isSchema(cur) ? cur : node;
}

/** Report each unsupported keyword present on this schema node. */
function checkKeywords(node: Schema, path: string, st: State): void {
  for (const kw of UNSUPPORTED_KEYWORDS) {
    if (kw in node) st.problems.push(`${path}: unsupported keyword "${kw}"`);
  }
}

/** Check one object node: additionalProperties and required. */
function checkObject(node: Schema, path: string, props: Schema, st: State): void {
  if (node["additionalProperties"] !== false) st.problems.push(`${path}: object needs additionalProperties: false`);
  const required = Array.isArray(node["required"]) ? (node["required"] as string[]) : [];
  for (const name of Object.keys(props)) {
    if (!required.includes(name)) st.problems.push(`${path}.${name}: property is not in "required"`);
  }
}

/** Recursive walk. `depth` = number of object levels on the way down to this node. */
function walk(raw: unknown, path: string, depth: number, st: State, seen: number): void {
  if (!isSchema(raw) || seen > 50) return; // seen guards against $ref cycles
  const node = deref(raw, st.root);
  checkKeywords(node, path, st);

  let childDepth = depth;
  if (isSchema(node["properties"])) {
    childDepth = depth + 1;
    st.maxDepth = Math.max(st.maxDepth, childDepth);
    st.propertyCount += Object.keys(node["properties"]).length;
    checkObject(node, path, node["properties"], st);
    for (const [name, child] of Object.entries(node["properties"])) {
      walk(child, `${path}.${name}`, childDepth, st, seen + 1);
    }
  } else if (node["type"] === "object") {
    checkObject(node, path, {}, st);
  }
  if (node["items"] !== undefined) walk(node["items"], `${path}[]`, childDepth, st, seen + 1);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const list = node[key];
    if (Array.isArray(list)) list.forEach((s, i) => walk(s, `${path}.${key}[${i}]`, childDepth, st, seen + 1));
  }
}

/**
 * Lint a JSON Schema against Azure strict-mode limits. Returns problems (empty = OK).
 * Example: checkAzureStrict(z.toJSONSchema(PageDraftSchema)) → []
 */
export function checkAzureStrict(jsonSchema: Record<string, unknown>): string[] {
  const st: State = { root: jsonSchema, problems: [], propertyCount: 0, maxDepth: 0 };
  if ("anyOf" in jsonSchema) st.problems.push("$: root must not be anyOf");
  if (jsonSchema["type"] !== "object") st.problems.push('$: root must be type "object"');
  walk(jsonSchema, "$", 0, st, 0);
  if (st.maxDepth > MAX_OBJECT_DEPTH) st.problems.push(`$: object nesting depth is ${st.maxDepth}, max ${MAX_OBJECT_DEPTH}`);
  if (st.propertyCount > MAX_PROPERTIES) st.problems.push(`$: ${st.propertyCount} object properties in total, max ${MAX_PROPERTIES}`);
  return st.problems;
}
