# The AI layer

Three of `AIGateway`'s four methods are implemented, in `ConversiaAIGateway`
(`src/ai/gateway.ts`), and registered at boot in `server.ts` whenever the
environment configures a provider:

```ts
// src/server.ts
if (aiConfigured()) {
  registerAIGateway(new ConversiaAIGateway());
  startIndexingWorker();
}
```

`aiConfigured()` gates it, so an unconfigured deployment behaves exactly as it
did before the layer existed — every surface below falls back to its honest
"not available" branch rather than a stub answer. This file documents what
each method actually does today, and what `analyzeWebsite` — the one method
still unimplemented — still owes.

---

## What switches on

| Surface             | Without a provider configured                    | With one configured                          |
| -------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Widget answer        | FAQ and catalogue only, then `needs_ai_backend`    | Falls through to a generated, cited answer, or a tool call (lead, ticket, product search) |
| Knowledge upload      | Stored, `pending`, `vectorCount: 0`                | Extracted, chunked, embedded, `ready`          |
| Retrieval tester      | Reports that retrieval is not installed            | Real passages and similarity scores            |
| Setup wizard crawl    | `501`                                               | `501` — still unimplemented either way         |
| AI analytics          | `501`                                               | `501` — still unimplemented either way         |

Each is gated on `aiGateway().isEnabled()`, so a half-configured deployment
degrades to the honest fallback rather than throwing at a visitor.

---

## The four methods

### `processDocument` — implemented

Extract → chunk → embed → index one uploaded document, run off the request
path by an indexing worker (`src/ai/indexing/worker.ts`) that claims pending
documents with `FOR UPDATE SKIP LOCKED` and a stale-lease reclaim.

Extraction (`src/ai/extract/`) handles PDF, DOCX and HTML; chunking
(`src/ai/chunking/chunker.ts`) targets coherence over fixed length — it
respects headings and paragraph boundaries rather than slicing at a token
count. The worker advances `status`, `progress`, `embedding_status`,
`index_status`, `vector_count` and the `pipeline` log as it runs; the document
view renders `pipeline` verbatim, so that log is what makes the screen honest
while processing is in flight.

### `retrieve` — implemented

pgvector-backed hybrid search (`src/ai/retrieval/retriever.ts`): a semantic
pass and a lexical full-text pass combined by reciprocal rank fusion, then
sorted by true cosine similarity for the threshold and the UI.

> **Every query is scoped to `companyId`.** This was, and remains, the most
> important line in the AI layer. A retrieval that crosses tenants leaks one
> customer's internal documents into another customer's chat answers.

Honours `collectionIds` — a collection with `available_to_chatbot = false` is
deliberately withheld. Returns `answered: false` with a `fallbackReason` when
nothing clears the threshold; the retrieval tester shows that reason directly,
which is how an administrator finds a gap in their own knowledge base.

### `answer` — implemented

One model call decides the whole turn (`src/ai/answer/decide.ts`): whether
the message is small talk, whether a curated FAQ answer already covers it,
whether the customer wants something done — in which case a tool runs
(`src/ai/tools/`) — or whether to answer from retrieved passages. Reached
**only after** that decision, never as the first thing tried.

`confidence` is reported, not acted on — the caller compares it against the
company's own `knowledgeConfidenceThreshold` and decides whether to answer or
offer a human. That decision stays with the configuration, never the provider,
so it is adjustable per workspace without a redeploy.

Applies the published chatbot config: `blockedTopics`, `allowedTopics`,
`systemPromptAddendum`, `personality`, `responseStyle`, `maxResponseWords`.

### `analyzeWebsite` — not implemented

Crawl a site and propose onboarding content. Still throws
`ai_layer_not_implemented`; `src/ai/example/gateway.example.ts` has a skeleton
to start from.

Write `website_analyses` and `website_analysis_suggestions`, return the id.
Every suggestion is a **proposal** — a human reviews each one, and accepting an
FAQ suggestion creates a *draft*. That review step is already built; do not
bypass it by writing published content directly.

---

## Where the seams are

| Call site               | File                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| Widget answer pipeline    | `modules/widget/widget.service.ts` → search for `The AI layer's turn`      |
| Document processing       | `modules/knowledge/knowledge.service.ts` → `queueForProcessing`            |
| Retrieval tester          | `modules/knowledge/knowledge.service.ts` → `runRetrievalTest`              |
| Website analysis          | `modules/wizard/wizard.service.ts` → `analyzeWebsite` — still the stub     |
| AI analytics              | `modules/analytics/analytics.routes.ts` → `/ai` — still `501`              |

The `The AI layer's turn` comments mark the exact lines where generation
enters the product. Everything above them answers from content a person wrote
or a catalogue row that exists.

---

## Things the rest of the system already guarantees

Relevant to `analyzeWebsite`, and to anything else added here later — none of
this needs re-implementing:

- **Tenant scoping** on every non-AI query, including a composite foreign key
  that makes cross-tenant assignment unrepresentable.
- **Published-only content.** The widget is served published config, published
  FAQ sets, and published questions. Drafts never reach a customer.
- **Human takeover.** The widget refuses to generate a reply into a
  conversation a person owns, so `answer()` is never called over an agent's
  head.
- **Conversation persistence.** Every turn is already written to
  `conversations` and `messages`; nothing here needs to record anything.
- **Internal notes** are filtered out of the visitor's transcript
  server-side.

---

## What not to do

**Do not return a plausible answer with no grounding.** The honest fallbacks
exist because a confident wrong answer about a refund policy is worse for the
customer than "let me get a colleague". `needs_ai_backend` and the retrieval
tester's fallback reason are product requirements, not placeholders — and the
same standard applies to `analyzeWebsite` once it exists: a crawl that found
nothing usable should say so, not invent a suggestion to fill the screen.

**Do not decide confidence policy inside a provider.** The threshold is the
company's, set in their chatbot config, and stays adjustable without
redeploying the backend.

**Do not write published content from a suggestion.** Accepted FAQ suggestions
become drafts. A human publishes.
