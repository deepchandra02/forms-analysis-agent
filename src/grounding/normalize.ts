/**
 * grounding/normalize.ts — the ONLY text changes we allow when joining spans into one string.
 *
 * WHAT:   Three tiny, separately exported rules. Everything else in the PDF text is kept
 *         byte-for-byte (quotes, dashes, odd spacing...) so a real extraction mistake
 *         is never silently "fixed" into something plausible.
 * INPUT:  spans (text + visual line number)
 * OUTPUT: joinSpans() → { text, applied } where `applied` names the rules that changed something
 * USED BY: src/grounding/resolve.ts (builds Form text), src/grounding/validate.ts (W_NORMALIZED)
 */

/** Names reported in `applied`. */
export type NormalizeRule = "whitespace" | "dehyphenate" | "ligature";

/** The minimum a span needs for joining. */
export interface JoinableSpan {
  text: string;
  line: number;
}

/**
 * RULE (c) ligatures. Replace ONLY the presentation-form ligatures U+FB00..U+FB06
 * (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ) by their plain letters.
 * WHY narrow: full NFKC would also change quotes, dashes, superscripts, "½", full-width
 * characters... Those are real content. Ligatures are purely a font artifact.
 * Example: "ﬁnal" → "final"
 */
export function expandLigatures(text: string): string {
  return text.replace(/[ﬀ-ﬆ]/g, (c) => c.normalize("NFKC"));
}

/**
 * RULE (a) whitespace. Collapse runs of whitespace to one space and trim.
 * WHY narrow: only spacing changes, never characters. Two spans are joined with exactly
 * one space (done by joinSpans), nothing smarter (no "smart" spacing before punctuation).
 * Example: "  Last   name " → "Last name"
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * RULE (b) de-hyphenation test. True only if ALL hold:
 *   1. `prev` ends with a letter followed by "-"        ("main-")
 *   2. `next` is on a LATER visual line                 (the word was wrapped)
 *   3. `next` starts with a LOWERCASE letter            ("taining")
 * WHY so strict: a real hyphen must survive. "e-" + "mail" on the same line, "Meyer-"
 * + "Schmidt" (capital → a double name), "Section 3-" + "5" (digits), or "non-" at the
 * end of a line followed by "-"-less words like "profit" are kept as written.
 * Known limit: "non-" + "profit" on a wrapped line IS joined ("nonprofit"). That is the
 * accepted cost of the rule, and it is reported via W_NORMALIZED for human review.
 */
export function shouldDehyphenate(prev: JoinableSpan, next: JoinableSpan): boolean {
  return /\p{L}-$/u.test(prev.text) && next.line > prev.line && /^\p{Ll}/u.test(next.text);
}

/**
 * Join spans into one string using the three rules above, and report which fired.
 * `whitespace` fires only if some span actually had odd whitespace (the plain single
 * space between spans is the baseline, not a "change").
 * Example: joinSpans([{text:"main-",line:1},{text:"taining",line:2}])
 *          → { text: "maintaining", applied: ["dehyphenate"] }
 */
export function joinSpans(spans: JoinableSpan[]): { text: string; applied: NormalizeRule[] } {
  const applied = new Set<NormalizeRule>();
  // Clean each span first (ligatures, then whitespace) so rule (b) sees trimmed text.
  const cleaned = spans.map((s) => {
    const noLig = expandLigatures(s.text);
    if (noLig !== s.text) applied.add("ligature");
    const clean = collapseWhitespace(noLig);
    if (clean !== noLig) applied.add("whitespace");
    return { text: clean, line: s.line };
  });

  let text = "";
  cleaned.forEach((span, i) => {
    if (i === 0) {
      text = span.text;
    } else if (shouldDehyphenate(cleaned[i - 1]!, span)) {
      text = text.slice(0, -1) + span.text; // drop the "-" and the space
      applied.add("dehyphenate");
    } else {
      text = `${text} ${span.text}`;
    }
  });
  // Empty spans would leave double spaces behind; this is part of rule (a).
  const final = collapseWhitespace(text);
  if (final !== text) applied.add("whitespace");
  return { text: final, applied: [...applied] };
}
