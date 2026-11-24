import { describe, expect, it } from "vitest";
import { collapseWhitespace, expandLigatures, joinSpans, shouldDehyphenate } from "../src/grounding/normalize.js";

const s = (text: string, line = 0) => ({ text, line });

describe("expandLigatures", () => {
  it("expands only U+FB00..FB06", () => {
    expect(expandLigatures("ﬁnal oﬀer ﬃx ﬆ")).toBe("final offer ffix st");
  });
  it("leaves quotes, dashes and other NFKC-able chars alone", () => {
    const keep = "“quoted” – dash ½ ² Ａ";
    expect(expandLigatures(keep)).toBe(keep);
  });
});

describe("collapseWhitespace", () => {
  it("collapses and trims", () => {
    expect(collapseWhitespace("  Last \t  name\n")).toBe("Last name");
  });
});

describe("shouldDehyphenate", () => {
  it("true: letter-hyphen, later line, lowercase", () => {
    expect(shouldDehyphenate(s("main-", 1), s("taining", 2))).toBe(true);
  });
  it("false: same line", () => {
    expect(shouldDehyphenate(s("e-", 1), s("mail", 1))).toBe(false);
  });
  it("false: next starts uppercase or digit", () => {
    expect(shouldDehyphenate(s("Meyer-", 1), s("Schmidt", 2))).toBe(false);
    expect(shouldDehyphenate(s("Section 3-", 1), s("5", 2))).toBe(false);
  });
  it("false: previous does not end with letter+hyphen", () => {
    expect(shouldDehyphenate(s("3-", 1), s("abc", 2))).toBe(false);
    expect(shouldDehyphenate(s("word", 1), s("abc", 2))).toBe(false);
    expect(shouldDehyphenate(s("word –", 1), s("abc", 2))).toBe(false);
  });
});

describe("joinSpans", () => {
  it("joins with a single space and reports nothing", () => {
    expect(joinSpans([s("Last"), s("name")])).toEqual({ text: "Last name", applied: [] });
  });
  it("whitespace rule", () => {
    expect(joinSpans([s(" Last  "), s("name ")])).toEqual({ text: "Last name", applied: ["whitespace"] });
  });
  it("dehyphenation", () => {
    expect(joinSpans([s("main-", 1), s("taining", 2)])).toEqual({ text: "maintaining", applied: ["dehyphenate"] });
  });
  it("keeps real hyphens on the same line", () => {
    expect(joinSpans([s("e-", 1), s("mail", 1)]).text).toBe("e- mail");
  });
  it("ligature rule", () => {
    expect(joinSpans([s("ﬁeld")])).toEqual({ text: "field", applied: ["ligature"] });
  });
  it("dehyphenates inside a longer chain", () => {
    expect(joinSpans([s("The main-", 1), s("taining party", 2), s("signs", 2)]).text).toBe("The maintaining party signs");
  });
});
