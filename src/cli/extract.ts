/**
 * cli/extract.ts — run the real input-extraction graph on a PDF (needs Azure env vars).
 *
 * WHAT:   Invokes the graph and writes three JSON files next to each other.
 * INPUT:  `npx tsx src/cli/extract.ts <pdf> [outDir=out]`
 * OUTPUT: <outDir>/<name>.form.json    final Form (exact PDF text)
 *         <outDir>/<name>.drafts.json  what the model answered, per page (IDs only)
 *         <outDir>/<name>.report.json  validator reports, statuses and the review list
 * USED BY: developers
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { graph } from "../agents/input-extraction/index.js";

const [pdfPath, outDir = "out"] = process.argv.slice(2);
if (!pdfPath) {
  console.error("usage: npx tsx src/cli/extract.ts <pdf> [outDir=out]");
  process.exit(1);
}

const name = basename(pdfPath, extname(pdfPath));
const result = await graph.invoke({ pdfPath });

await mkdir(outDir, { recursive: true });
const write = (suffix: string, data: unknown) => writeFile(join(outDir, `${name}.${suffix}.json`), JSON.stringify(data, null, 2));
await write("form", result.form);
await write("drafts", result.drafts);
await write("report", { statuses: result.statuses, reports: result.reports, review: result.review });

const failed = Object.entries(result.statuses).filter(([, s]) => s === "failed").map(([p]) => p);
console.log(`Wrote ${outDir}/${name}.{form,drafts,report}.json`);
console.log(`Pages: ${Object.keys(result.statuses).length}, failed: ${failed.length ? failed.join(",") : "none"}, review items: ${result.review.length}`);
