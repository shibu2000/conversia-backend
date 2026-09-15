import { logger } from "../../config/logger";
import { aiProviders } from "../providers";
import type { CompanyContext } from "../context/company-context";
import { toneInstructions } from "./prompt";

/**
 * Turns that are conversation rather than enquiry.
 *
 * "Hi" has nothing to retrieve, so a purely grounded assistant refuses it — and
 * a shop assistant who will not say hello reads as broken long before anyone
 * tests its knowledge. These turns are answered from the company profile alone,
 * which is drawn entirely from the company's own records.
 *
 * The permission granted here is deliberately narrow: greet, acknowledge, and
 * say what you can help with. Any claim about a policy, a price or an order
 * still has to come from a retrieved passage, and the prompt below says so.
 */

export type ConversationalKind = "greeting" | "thanks" | "farewell" | "identity" | "capability";

const PATTERNS: Array<{ kind: ConversationalKind; test: RegExp }> = [
  { kind: "greeting", test: /^(hi|hii+|hey+|hello+|yo|howdy|namaste|hola|good\s+(morning|afternoon|evening|day))\b/i },
  { kind: "thanks", test: /^(thanks?|thank\s+you|thx|ty|cheers|appreciate\s+it|great,?\s+thanks)\b/i },
  { kind: "farewell", test: /^(bye|goodbye|see\s+you|see\s+ya|that'?s\s+(all|it)|nothing\s+else|no\s+thanks?)\b/i },
  { kind: "identity", test: /\b(are\s+you\s+(a\s+)?(real\s+)?(bot|robot|human|person|ai)|who\s+are\s+you|what\s+are\s+you|am\s+i\s+talking\s+to\s+a)\b/i },
  { kind: "capability", test: /\b(what\s+can\s+you\s+(do|help)|how\s+can\s+you\s+help|can\s+you\s+help\s+me\??$|what\s+do\s+you\s+do)\b/i },
];

/**
 * Leading pleasantries, so "Hi, can I return this?" is read as the question it
 * is rather than as a greeting. This is the guard that keeps the conversational
 * path from swallowing real enquiries.
 */
const LEADING_PLEASANTRY =
  /^\s*(hi+|hey+|hello+|yo|howdy|namaste|hola|good\s+(morning|afternoon|evening|day)|thanks?|thank\s+you)\b[\s,.!–-]*/i;

export function classifyConversational(question: string): ConversationalKind | null {
  const text = question.trim();
  if (!text || text.length > 200) return null;

  // Strip an opening greeting and see whether a question survives it. Anything
  // with real content left over belongs to the knowledge path.
  const remainder = text.replace(LEADING_PLEASANTRY, "").trim();
  const isBarePleasantry = remainder.length === 0 || /^[\s?.!]*$/.test(remainder);

  for (const { kind, test } of PATTERNS) {
    if (!test.test(text)) continue;
    // Greetings, thanks and farewells only count when nothing else was said.
    // Identity and capability questions are complete questions in themselves.
    if (kind === "identity" || kind === "capability") return kind;
    if (isBarePleasantry) return kind;
    return null;
  }

  return null;
}

const GUIDANCE: Record<ConversationalKind, string> = {
  greeting: "The customer has said hello. Greet them and invite their question.",
  thanks: "The customer has thanked you. Acknowledge it briefly and offer further help.",
  farewell: "The customer is ending the conversation. Say goodbye warmly and briefly.",
  identity: "The customer is asking what you are. Say plainly that you are an assistant, not a person, and that you can pass them to a colleague.",
  capability: "The customer is asking what you can help with. Tell them, using only the list in ABOUT THE BUSINESS.",
};

export async function answerConversationally(
  kind: ConversationalKind,
  context: CompanyContext,
): Promise<string> {
  const { chat } = aiProviders();

  const system = [
    "ABOUT THE BUSINESS",
    context.profile,
    "",
    ...toneInstructions(context.ai),
    "",
    GUIDANCE[kind],
    "",
    "Use ONLY the facts in ABOUT THE BUSINESS.",
    "You must not state any policy, price, delivery time, stock level or order detail — you do not know them.",
    "If the customer goes on to ask about any of those, you will be given the relevant passages then.",
    "Do not invent an offer, a discount or a promise.",
    "Reply in at most two short sentences. Do not list your capabilities unless asked.",
  ].join("\n");

  try {
    const completion = await chat.complete({
      system,
      user: `(the customer's message is a ${kind})`,
      temperature: clamp(context.ai.creativity),
      // Enough headroom to finish the sentence. A greeting truncated
      // mid-word reads far worse than a slightly long one.
      maxTokens: 180,
    });

    const text = completion.text.trim();
    if (text) return text;
  } catch (error) {
    logger.warn("Conversational reply fell back to the configured message", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // The model being unreachable must not stop the assistant saying hello.
  return context.welcomeMessage || `Hello! I'm ${context.botName}. How can I help?`;
}

function clamp(creativity: number): number {
  if (!Number.isFinite(creativity)) return 0.4;
  return Math.min(1, Math.max(0, creativity));
}
