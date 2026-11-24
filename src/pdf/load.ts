/**
 * pdf/load.ts — open a PDF file with pdf.js in Node.
 *
 * WHAT:   Reads the file into memory and hands it to pdf.js (the "legacy" build, which
 *         works in Node without a canvas or a browser worker).
 * INPUT:  path to a .pdf file
 * OUTPUT: a pdf.js document (PDFDocumentProxy)
 * USED BY: src/pdf/extract.ts
 */
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Open a PDF from disk.
 * Example: `const doc = await loadPdf("sample-forms/event-of-death-en.pdf")`.
 *
 * Options chosen on purpose:
 *  - verbosity 0:           pdf.js prints noisy font warnings otherwise.
 *  - disableFontFace:       we never render, so don't try to build browser fonts.
 *  - fontExtraProperties:   keeps the real font name (e.g. "Frutiger45LightBold"),
 *                           which is the only reliable way to detect bold text.
 */
export async function loadPdf(path: string): Promise<PDFDocumentProxy> {
  const bytes = await readFile(path);
  // pdf.js wants a plain Uint8Array (not a Node Buffer) and takes ownership of it.
  const data = new Uint8Array(bytes);
  const task = getDocument({
    data,
    verbosity: 0,
    disableFontFace: true,
    fontExtraProperties: true,
  });
  return task.promise;
}
