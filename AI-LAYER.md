# Adding the AI layer

Everything that needs AI is already wired, guarded, and falling back honestly.
Adding the layer means implementing one interface and registering it once.

```ts
// src/server.ts
import { registerAIGateway } from "./ai/ai-gateway";
import { ConversiaAIGateway } from "./ai/gateway";

registerAIGateway(new ConversiaAIGateway());
```

That single call turns on every AI branch in the product. **No other file
changes.** Start from `src/ai/example/gateway.example.ts`.

---

## What switches on

| Surface | Today | After |
|---|---|---|
| Widget answer | FAQ and catalogue only, then `needs_ai_backend` | Falls through to a generated, cited answer |
| Knowledge upload | Stored, `pending`, `vectorCount: 0` | Extracted, chunked, embedded, `ready` |
| Retrieval tester | Reports that retrieval is not installed | Real passages and similarity scores |
| Setup wizard crawl | `501` | Crawls and proposes content for review |
| AI analytics | `501` | Real figures |

Each is gated on `aiGateway().isEnabled()`, so a half-configured deployment
degrades to the current honest behaviour rather than throwing at a visitor.

---

## The four methods

### `processDocument`

Extract → chunk → embed → index one uploaded document.

Called on upload and on re-index. Read the bytes via `storageKey`, write
`extracted_text`, create `knowledge_chunks`, embed them, and advance `status`,
`progress`, `embedding_status`, `index_status`, `vector_count` and the
`pipeline` log as you go — the document view renders `pipeline` verbatim, so
keeping it current is what makes that screen honest while processing runs.

Run it off the request path for anything larger than a few pages.

### `retrieve`

Semantic search over one company's knowledge.

> **Scope every query to `companyId`.** This is the most important line in the
> AI layer. A retrieval that crosses tenants leaks one customer's internal
> documents into another customer's chat answers.

Honour `collectionIds` — a collection with `available_to_chatbot = false` is
deliberately withheld. Return `answered: false` with a `fallbackReason` when
nothing clears the threshold; the retrieval tester shows that reason directly,
and it is how an administrator finds gaps.

### `answer`

A generated reply for one customer turn.

Reached **only after FAQ and the catalogue have both missed** — genuinely the
last resort, not the first thing tried. Ground it in retrieved passages and
return them as `citations`; the widget renders them beneath the answer.

Return `confidence` but do **not** act on it. The caller compares it against the
company's own `knowledgeConfidenceThreshold` and decides whether to answer or
offer a human. That decision belongs with the configuration, not the provider.

Apply the published chatbot config: `blockedTopics`, `allowedTopics`,
`systemPromptAddendum`, `personality`, `responseStyle`, `maxResponseWords`.

### `analyzeWebsite`

Crawl a site and propose onboarding content.

Write `website_analyses` and `website_analysis_suggestions`, return the id. Every
suggestion is a **proposal** — a human reviews each one, and accepting an FAQ
suggestion creates a *draft*. That review step is already built; do not bypass it
by writing published content.

---

## Where the seams are

| Call site | File |
|---|---|
| Widget answer pipeline | `modules/widget/widget.service.ts` → search for `The AI layer's turn` |
| Document processing | `modules/knowledge/knowledge.service.ts` → `queueForProcessing` |
| Retrieval tester | `modules/knowledge/knowledge.service.ts` → `runRetrievalTest` |
| Website analysis | `modules/wizard/wizard.service.ts` → `analyzeWebsite` |
| AI analytics | `modules/analytics/analytics.routes.ts` → `/ai` |

Both `The AI layer's turn` comments mark the exact lines where generation enters
the product. Everything above them answers from content a person wrote or a
catalogue row that exists.

---

## Things the rest of the system already guarantees

You do not need to re-implement these:

- **Tenant scoping** on every non-AI query, including a composite foreign key
  that makes cross-tenant assignment unrepresentable.
- **Published-only content.** The widget is served published config, published
  FAQ sets, and published questions. Drafts never reach a customer.
- **Human takeover.** `ask()` refuses to answer a conversation a person owns, so
  your `answer()` is never called over an agent's head.
- **Conversation persistence.** Every turn is already written to `conversations`
  and `messages`; you do not need to record anything.
- **Internal notes** are filtered out of the visitor's transcript server-side.

---

## What not to do

**Do not return a plausible answer with no grounding.** The honest fallbacks
exist because a confident wrong answer about a refund policy is worse for the
customer than "let me get a colleague". The `needs_ai_backend` branch and the
retrieval tester's fallback reason are product requirements, not placeholders.

**Do not decide confidence policy inside the provider.** The threshold is the
company's, set in their chatbot config, and it should stay adjustable without
redeploying you.

**Do not write published content from a suggestion.** Accepted FAQ suggestions
become drafts. A human publishes.
