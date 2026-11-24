/**
 * cli/dump-page.ts — debug tool: print what the PDF layer extracted, in a compact form.
 *
 * WHAT:   Runs extractPdf and prints spans, widgets and rules of one page (or all pages).
 *         No model involved.
 * INPUT:  `npx tsx src/cli/dump-page.ts <pdf> [page]`
 * OUTPUT: text on stdout, e.g. `p1.s14 | Last name | 49.3,226.5,38.1,8 | 8pt | bold`
 * USED BY: developers, while tuning src/pdf/*
 */
import { extractPdf } from "../pdf/extract.js";
import type { Box, PdfPage } from "../pdf/types.js";

/** "x,y,w,h" */
function fmtBox(b: Box): string {
  return `${b.x},${b.y},${b.w},${b.h}`;
}

/** Print one page. */
function dumpPage(p: PdfPage): void {
  console.log(`=== page ${p.page}  ${p.width}x${p.height}  spans=${p.spans.length} widgets=${p.widgets.length} rules=${p.rules.length}`);
  console.log("--- spans");
  for (const s of p.spans) {
    const flags = [`${s.fontSize}pt`, s.bold ? "bold" : "", s.source === "widget" ? `widget=${s.widgetId}` : ""].filter(Boolean);
    console.log(`${s.id} | L${s.line} | ${s.text} | ${fmtBox(s.box)} | ${flags.join(" | ")}`);
  }
  console.log("--- widgets");
  for (const w of p.widgets) {
    const opts = w.options.length ? ` options=[${w.options.map((o) => `${o.id}:${o.text}`).join("; ")}]` : "";
    const val = w.value !== null ? ` value="${w.value}" (${w.valueSpanId})` : "";
    console.log(`${w.id} | ${w.kind}${w.multiline ? " multiline" : ""} | ${fmtBox(w.box)}${opts}${val}`);
  }
  console.log("--- rules");
  for (const r of p.rules) console.log(`${r.id} | ${r.orientation} | ${fmtBox(r.box)}`);
}

const [path, pageArg] = process.argv.slice(2);
if (!path) {
  console.error("usage: npx tsx src/cli/dump-page.ts <pdf> [page]");
  process.exit(1);
}
const doc = await extractPdf(path);
console.log(`${doc.sourceFile}: ${doc.pageCount} pages, isAcroForm=${doc.isAcroForm}`);
for (const p of doc.pages) if (!pageArg || p.page === Number(pageArg)) dumpPage(p);
