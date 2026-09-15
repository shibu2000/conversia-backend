import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { isHeading } from "../chunking/chunker";

/**
 * Turning an uploaded file into plain text.
 *
 * Every branch returns text or throws with a reason an administrator can act on
 * — "this PDF has no extractable text, it is probably a scan" is useful; a
 * silently empty document that indexes to zero chunks is not.
 */

export interface ExtractedDocument {
  text: string;
  /** Present for paginated formats; the document sidebar hides the row when null. */
  pageCount: number | null;
}

export async function extractDocument(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractedDocument> {
  const type = mimeType.toLowerCase();
  const extension = filename.toLowerCase().split(".").pop() ?? "";

  if (type === "application/pdf" || extension === "pdf") return extractPdf(buffer);
  if (type.includes("wordprocessingml") || type === "application/msword" || extension === "docx") {
    return extractDocx(buffer);
  }
  if (type === "text/html" || extension === "html" || extension === "htm") {
    return { text: stripHtml(buffer.toString("utf8")), pageCount: null };
  }

  // Everything else is text we can read directly: txt, md, csv, json.
  return { text: normalise(buffer.toString("utf8")), pageCount: null };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  // Page markers survive into the chunker, which turns them into the `locator`
  // shown beside each chunk — so a citation can say which page it came from.
  const joined = pages
    .map((page, index) => `\n\n[[page:${index + 1}]]\n\n${reflow(normalise(page))}`)
    .join("")
    .trim();

  if (joined.replace(/\[\[page:\d+\]\]/g, "").trim().length === 0) {
    throw new Error("No text could be read from this PDF. If it is a scan, it needs OCR before it can be indexed.");
  }

  return { text: joined, pageCount: totalPages };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const { value } = await mammoth.extractRawText({ buffer });
  // mammoth emits one line per Word paragraph, so every newline is already a
  // real paragraph break — the opposite of a PDF, and it must not be reflowed.
  const text = normalise(value).replace(/\n(?!\n)/g, "\n\n");
  if (!text) throw new Error("No text could be read from this document.");
  return { text, pageCount: null };
}

/**
 * Rebuild paragraphs from hard-wrapped lines.
 *
 * A PDF has no paragraphs — it has lines at coordinates, and extraction returns
 * one line per visual line. Left alone, a whole page arrives as a single block
 * with its headings buried mid-line, and the chunker can only split it by size:
 * exactly the topic-mixing that measured 0.56 similarity instead of 0.79.
 *
 * A line break is treated as a real break when the line is a heading or the one
 * before it ended a sentence. Otherwise it is a wrap, and the lines are rejoined
 * so a sentence split across two lines stays one sentence.
 */
function reflow(text: string): string {
  const lines = text.split("\n").map((line) => line.trim());
  const blocks: string[] = [];
  let current = "";

  for (const line of lines) {
    if (!line) {
      if (current) blocks.push(current);
      current = "";
      continue;
    }

    const previousEndedSentence = /[.!?:;]$/.test(current);
    if (!current || isHeading(line) || isHeading(current) || previousEndedSentence) {
      if (current) blocks.push(current);
      current = line;
    } else {
      current = `${current} ${line}`;
    }
  }

  if (current) blocks.push(current);
  return blocks.join("\n\n");
}

/**
 * HTML to text.
 *
 * Script and style contents are dropped rather than flattened — a page's
 * JavaScript is not knowledge, and leaving it in would fill the index with
 * minified source that matches nothing a customer asks.
 */
function stripHtml(html: string): string {
  return normalise(
    html
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

/** Normalise line endings and collapse runs of blank lines, which mark paragraphs. */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
