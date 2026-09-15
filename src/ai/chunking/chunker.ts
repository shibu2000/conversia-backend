/**
 * Splitting a document into passages worth embedding.
 *
 * The measurement that shaped this: embedding the same answer sentence at
 * increasing lengths costs almost nothing in similarity when the surrounding
 * text is about the same subject (0.792 → 0.762 from 40 to 650 tokens), and
 * costs a great deal when it is not (0.792 → 0.558). Mixing two topics in one
 * chunk moves its vector to the average of both, which matches neither well.
 *
 * So size is a budget here, never a ruler. The splitter follows the document's
 * own structure and falls back to finer boundaries only when a section will not
 * fit — and the ceiling is a correctness rule rather than a preference, because
 * the embedding model truncates over-long input without reporting it.
 */

/** ~350 tokens. Comfortably one topic, comfortably quotable in a citation. */
const TARGET_CHARS = 1_400;
/** ~700 tokens, well inside the model's 2048-token context even with its prefix. */
const MAX_CHARS = 2_800;
/** Below this a chunk is a fragment; it joins the one before it instead. */
const MIN_CHARS = 400;

export interface Chunk {
  text: string;
  /** Where in the document it came from: a heading, or "Page 4". */
  locator: string;
  /** A `chars / 4` estimate, shown in the admin UI. Not a tokeniser count. */
  tokenCount: number;
}

const PAGE_MARKER = /^\[\[page:(\d+)\]\]$/;

export function chunkDocument(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer = "";
  /** Where the *current buffer* began — not where it happens to end. */
  let bufferLocator = "";
  let locator = "";
  let heading = "";
  let page = "";

  /**
   * A heading whose section turned out to be empty — a document title followed
   * straight by a subheading. It leads the next chunk instead of becoming one:
   * "RETURNS AND REFUNDS" on its own is a label, and nothing a customer asks
   * will ever match it.
   */
  let carry = "";

  /** True while the buffer holds headings and nothing else. */
  let headingOnly = true;

  const append = (block: string, isHeadingBlock: boolean) => {
    if (!buffer) {
      bufferLocator = locator;
      headingOnly = true;
      if (carry) {
        buffer = carry;
        carry = "";
      }
    }
    if (!isHeadingBlock) headingOnly = false;
    buffer = buffer ? `${buffer}\n\n${block}` : block;
  };

  const flush = () => {
    const body = buffer.trim();
    const from = bufferLocator;
    buffer = "";
    if (!body) return;

    if (headingOnly) {
      carry = carry ? `${carry}\n\n${body}` : body;
      return;
    }

    const previous = chunks[chunks.length - 1];
    /**
     * A fragment rejoins what precedes it — but only inside the same section.
     *
     * Merging across a heading would undo the split that heading asked for, and
     * a document of short sections would collapse into one chunk covering every
     * subject in it. That is the exact shape that measured 0.56 instead of 0.79.
     */
    if (
      body.length < MIN_CHARS &&
      previous &&
      previous.locator === from &&
      previous.text.length + body.length <= MAX_CHARS
    ) {
      previous.text = `${previous.text}\n\n${body}`;
      previous.tokenCount = estimateTokens(previous.text);
      return;
    }

    chunks.push({ text: body, locator: from, tokenCount: estimateTokens(body) });
  };

  for (const block of splitBlocks(text)) {
    const pageMatch = block.text.match(PAGE_MARKER);
    if (pageMatch) {
      // A page break is not a topic break, so it does not end a chunk — it only
      // changes where text that follows will say it came from.
      page = `Page ${pageMatch[1]}`;
      locator = heading ? `${heading} · ${page}` : page;
      continue;
    }

    if (block.heading) {
      // A heading is the clearest signal a document gives that the subject has
      // changed, which is exactly where a chunk boundary belongs.
      flush();
      heading = block.text.replace(/^#+\s*/, "").trim().slice(0, 120);
      locator = page ? `${heading} · ${page}` : heading;
      append(block.text, true);
      continue;
    }

    if (block.text.length > MAX_CHARS) {
      flush();
      for (const piece of splitLongBlock(block.text)) {
        append(piece, false);
        flush();
      }
      continue;
    }

    if (buffer.length + block.text.length + 2 > TARGET_CHARS) flush();
    append(block.text, false);
  }

  flush();

  // A heading left over at the end has no section to lead. Keep it with the last
  // chunk rather than dropping it — nothing from the document should vanish.
  if (carry) {
    const last = chunks[chunks.length - 1];
    if (last && last.text.length + carry.length <= MAX_CHARS) {
      last.text = `${last.text}\n\n${carry}`;
      last.tokenCount = estimateTokens(last.text);
    } else {
      chunks.push({ text: carry, locator: bufferLocator, tokenCount: estimateTokens(carry) });
    }
  }

  return withOverlap(chunks);
}

interface Block {
  text: string;
  /** Decided once, here, so the packing loop never has to re-derive it. */
  heading: boolean;
}

/**
 * Paragraphs, with page markers kept as blocks of their own.
 *
 * A heading is very often joined to the paragraph it introduces by a single
 * newline rather than a blank line — markdown, Word and plain text all do it.
 * Left joined, the block contains a newline, no heading is recognised in it,
 * and a whole document of short sections packs into one chunk covering every
 * subject in it. So a leading heading line is split off to stand on its own.
 */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  for (const raw of text.split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;

    const firstBreak = block.indexOf("\n");
    if (firstBreak > 0) {
      const firstLine = block.slice(0, firstBreak).trim();
      const rest = block.slice(firstBreak + 1).trim();
      if (isHeading(firstLine) || isSectionTitle(firstLine, rest)) {
        blocks.push({ text: firstLine, heading: true });
        if (rest) blocks.push({ text: rest, heading: false });
        continue;
      }
      blocks.push({ text: block, heading: false });
      continue;
    }

    // A single line on its own. `isSectionTitle` needs following text to judge
    // by, so the next block supplies it once the loop reaches this one.
    blocks.push({ text: block, heading: isHeading(block) });
  }

  // A lone line followed by a longer paragraph is a heading for the same reason
  // a leading line is, and this is the first point where the next block is known.
  for (let index = 0; index < blocks.length - 1; index += 1) {
    const current = blocks[index]!;
    const next = blocks[index + 1]!;
    if (!current.heading && !current.text.includes("\n") && !next.heading) {
      current.heading = isSectionTitle(current.text, next.text);
    }
  }

  return blocks;
}

/**
 * Headings, by the shapes documents actually use.
 *
 * Deliberately conservative — a false positive splits a paragraph away from its
 * own topic sentence, which is the failure this whole module exists to avoid.
 */
export function isHeading(block: string): boolean {
  if (block.length > 120 || block.includes("\n")) return false;
  if (/^#{1,6}\s+\S/.test(block)) return true;
  if (/^\d+(\.\d+)*[.)]\s+\S/.test(block) && block.length < 90) return true;
  // An all-caps line with no sentence punctuation reads as a section title.
  if (block === block.toUpperCase() && /[A-Z]{3}/.test(block) && !/[.!?]$/.test(block)) return true;
  return false;
}

/**
 * A plain title-case section title — "Domestic delivery", "Claim process".
 *
 * `isHeading` will not accept these, and rightly so: on its own such a line is
 * indistinguishable from a wrapped line of prose, and treating one as a heading
 * would cut a sentence in half. Here the context settles it — the line opens a
 * blank-line-delimited block, it is short, it ends no sentence, and a longer
 * body follows it. That combination is a heading in nearly every document and a
 * wrapped line in almost none.
 */
function isSectionTitle(line: string, rest: string): boolean {
  if (!rest || line.length > 80 || rest.length <= line.length) return false;
  if (line.split(/\s+/).length > 10) return false;
  // A full stop, comma or conjunction at the end means the thought continues.
  if (/[.!?,;]$/.test(line)) return false;
  if (/\b(and|or|but|of|to|in|for|with|the|a|an)$/i.test(line)) return false;
  return /^[A-Z0-9]/.test(line);
}

/** Sentence-wise packing, used only when one paragraph exceeds the ceiling. */
function splitLongBlock(block: string): string[] {
  const sentences = block.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [block];
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // A single sentence longer than the ceiling — a table row, or a wall of text
    // with no punctuation. Cut it hard: a truncated embedding is worse.
    if (trimmed.length > MAX_CHARS) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      for (let index = 0; index < trimmed.length; index += MAX_CHARS) {
        pieces.push(trimmed.slice(index, index + MAX_CHARS));
      }
      continue;
    }

    if (current.length + trimmed.length + 1 > TARGET_CHARS) {
      pieces.push(current);
      current = trimmed;
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Carry one sentence across each boundary.
 *
 * A rule and its qualifier — "within 30 days" and "provided the item is
 * unworn" — sometimes land either side of a split. One sentence of overlap
 * makes that pair retrievable from both chunks at a cost of a few percent more
 * storage.
 */
function withOverlap(chunks: Chunk[]): Chunk[] {
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;

    const previous = chunks[index - 1]!.text;
    const sentences = previous.match(/[^.!?\n]+[.!?]+/g);
    const tail = sentences?.[sentences.length - 1]?.trim();
    if (!tail || tail.length > 300 || chunk.text.length + tail.length > MAX_CHARS) return chunk;

    const text = `${tail}\n\n${chunk.text}`;
    return { ...chunk, text, tokenCount: estimateTokens(text) };
  });
}

/**
 * Four characters per token.
 *
 * A rough English average, and honest about being one — the real tokeniser
 * lives inside the model. It is used for display and for keeping chunks clear
 * of the context ceiling, never for billing or for anything a number's accuracy
 * would change.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
