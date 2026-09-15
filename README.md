# Conversia API

The backend for Conversia — a multi-tenant AI customer interaction, sales and
support platform. This service owns everything the product does *except* the AI
layer: tenancy, authentication, RBAC, customers, conversations, leads, tickets,
products, FAQ, Knowledge Base document management, chatbot configuration,
analytics, and the public chat-widget endpoints.

**The AI layer is deliberately not implemented.** See
[What is left to the AI layer](#what-is-left-to-the-ai-layer).

---

## Stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| Runtime        | Node 20+, TypeScript, Express                        |
| Database       | PostgreSQL 14+ with `pg_trgm`                        |
| ORM            | Drizzle ORM (typed queries, generated SQL migrations)|
| Validation     | Zod, at every request boundary                       |
| Auth           | Short-lived JWT access tokens + rotating refresh tokens |
| Uploads        | multer (memory) → local disk behind a storage seam   |

---

## Getting started

```bash
cp .env.example .env          # then fill in the two JWT secrets
npm install
npm run db:setup              # create database, migrate, seed demo data
npm run dev                   # http://localhost:4000/api/v1
```

Generate the secrets with:

```bash
openssl rand -base64 48
```

### Seeded accounts

Every seeded account uses the password in `SEED_PASSWORD`.

| Account                              | Role                                |
| ------------------------------------ | ----------------------------------- |
| `meera.krishnan@northwindretail.com` | Company Admin (the demo workspace)  |
| `priya.sharma@northwindretail.com`   | Manager                             |
| `amit.sharma@northwindretail.com`    | Sales                               |
| `james.whitfield@northwindretail.com`| Support                             |
| `elena.novak@northwindretail.com`    | Viewer (read-only)                  |
| `alex.chen@conversia.ai`             | Platform super admin                |

The seed creates one fully-populated company plus fifteen thinner tenants. The
extra tenants are not decoration: a missing `company_id` predicate is invisible
against a single-tenant dataset.

---

## Scripts

| Script                  | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `npm run dev`           | Watch mode                                          |
| `npm run build`         | Compile to `dist/`                                  |
| `npm start`             | Run the compiled build                              |
| `npm run typecheck`     | Types only                                          |
| `npm run db:create`     | Create the database if absent                       |
| `npm run db:generate`   | Generate a migration from schema changes            |
| `npm run db:migrate`    | Apply pending migrations                            |
| `npm run db:seed`       | Load demo data (refuses to run in production)       |
| `npm run db:reset`      | Drop and recreate the schema (development only)     |
| `npm run db:setup`      | create + migrate + seed                             |
| `npm run db:studio`     | Drizzle Studio                                      |

Migrations are **generated, reviewed and committed** — never applied from a
schema diff computed at deploy time. Production always runs SQL someone has read.

---

## Architecture

```
src/
├── server.ts              Boot, graceful shutdown
├── app.ts                 Express app: helmet, CORS, limits, error handling
├── routes.ts              The whole API surface, mounted in three trust tiers
├── config/                env (Zod-validated), logger
├── core/                  errors, ids, list-query, permissions, serialisers
├── middleware/            authenticate, authorize, company-scope, validate, …
├── db/
│   ├── schema/            Drizzle tables, enums, relations
│   ├── migrate.ts         Applies drizzle/*.sql
│   └── seed/              Demo data
├── ai/ai-gateway.ts       The AI seam — interface only, no implementation
└── modules/<domain>/      routes → controller → service (+ schema, mapper)
```

Each domain module is the same four files, in the same order:

- **`*.routes.ts`** — paths, permissions, validation middleware
- **`*.controller.ts`** — reads the request, calls the service, sends the response
- **`*.service.ts`** — the actual work, including all database access
- **`*.schema.ts`** — Zod request shapes
- **`*.mapper.ts`** — database row → the shape the frontend's types declare

---

## API surface

Three tiers, in order of trust. Everything is under `API_PREFIX` (`/api/v1`).

### Public — the embedded widget

No session. Keyed by the public embed key, which appears in the page source of
any site running the widget, so these serve published content only and accept
only customer-initiated writes. The request's `Origin` is checked against the
workspace's allowed domains.

```
GET    /widget/:key/config                 Published config, minus the `ai` section
GET    /widget/:key/popular-questions
GET    /widget/:key/topics
GET    /widget/:key/answers/:faqId
POST   /widget/:key/answers/:faqId/rate
GET    /widget/:key/products
GET    /widget/:key/embed-policy           frame-ancestors for the embed page
POST   /widget/:key/ask                    Answers, and records the exchange
POST   /widget/:key/leads                  Writes a real lead
POST   /widget/:key/tickets                Writes a real ticket
POST   /widget/:key/handoff                Moves the thread to the agent queue
```

### Authentication

```
POST   /auth/login                POST /auth/register          POST /auth/refresh
POST   /auth/logout               POST /auth/logout-everywhere
POST   /auth/forgot-password      POST /auth/reset-password    POST /auth/accept-invite
GET    /auth/me                   POST /auth/change-password
POST   /auth/impersonate          POST /auth/stop-impersonating   (super admin)
```

### Platform console — super admin

```
GET    /platform/analytics                 GET  /platform/health
GET    /platform/ai-providers              PATCH /platform/ai-providers/:id
GET    /platform/users                     Cross-tenant user directory
GET    /platform/companies                 GET  /platform/companies/filter-options
POST   /platform/companies                 Provision a workspace + invite its admin
GET    /platform/companies/:id             PATCH /platform/companies/:id
POST   /platform/companies/:id/status
```

### Workspace — tenant-scoped

Mounted twice: at `/workspace/…` and at `/companies/:companyId/…`, because the
frontend's service layer is shaped the second way. Both resolve the tenant from
the session; the path parameter is routing, never authority.

```
conversations   GET /  ·  GET /view-counts  ·  GET /:id  ·  GET|POST /:id/messages
                PATCH /:id  ·  POST /:id/assign  ·  DELETE /:id
customers       GET /  ·  GET /filter-options  ·  POST /  ·  GET /:id
                GET /:id/profile  ·  PATCH /:id  ·  DELETE /:id
leads           GET /  ·  GET /summary  ·  POST /  ·  GET /:id  ·  PATCH /:id
                POST /:id/status  ·  POST /:id/assign  ·  POST /:id/notes  ·  DELETE /:id
tickets         GET /  ·  GET /summary  ·  POST /  ·  GET /:id  ·  PATCH /:id
                POST /:id/status  ·  POST /:id/assign  ·  POST /:id/replies  ·  DELETE /:id
products        GET|POST /products  ·  GET|PATCH|DELETE /products/:id
                GET|POST /product-categories
users           GET /users  ·  GET /users/assignable  ·  POST /users
                GET|PATCH /users/:id  ·  POST /users/:id/{role,status,resend-invite}
                GET /users/:id/activity
roles & teams   GET|POST /roles  ·  PATCH|DELETE /roles/:id  ·  PUT /roles/:id/permissions
                GET|POST /teams
faqs            GET|POST /faqs/sets  ·  GET|PATCH|DELETE /faqs/sets/:id
                GET /faqs/sets/:id/tree  ·  GET /faqs/sets/:id/questions
                POST /faqs/categories  ·  PATCH|DELETE /faqs/categories/:id
                POST /faqs/questions   ·  GET|PATCH|DELETE /faqs/questions/:id
                POST /faqs/move
knowledge       GET|POST /knowledge/collections  ·  PATCH /knowledge/collections/:id
                GET|POST /knowledge/sources  ·  GET|PATCH|DELETE /knowledge/sources/:id
                POST /knowledge/sources/:id/reindex
                GET /knowledge/documents  ·  GET|DELETE /knowledge/documents/:id
                GET /knowledge/documents/:id/{chunks,download}
                POST /knowledge/documents/:id/reindex
                POST /knowledge/retrieval-test
chatbot-config  GET|PATCH /  ·  POST /publish  ·  GET /versions
                POST /domains  ·  DELETE /domains/:domain  ·  POST /rotate-key
wizard          GET|PATCH /  ·  POST /steps/:key/{complete,skip}
                GET /website-analysis  ·  POST /analyze-website  (501)
                POST /suggestions/:id  ·  POST /suggestions/review-all
analytics       GET /dashboard  ·  GET /conversations  ·  GET /business
                GET /knowledge  ·  GET /ai  (501)
company         GET|PATCH /  ·  GET|PATCH /settings
search          GET /?q=
```

### Per-user

```
GET  /me/notifications          GET  /me/notifications/unread-count
POST /me/notifications/:id/read POST /me/notifications/read-all
```

---

## Multi-tenancy

Four things enforce it, in order of how hard they are to get wrong:

1. **`companyScope` middleware** resolves the tenant from the *access token*.
   A company id does appear in URLs (`/companies/:companyId/leads`) because the
   frontend's service layer is shaped that way — but it is never the authority.
   If the URL names a different company than the session, the request is
   refused rather than silently redirected.

2. **Every query filters on `companyId`.** Services take it as their first
   argument and it comes from `req.companyId`, which only `companyScope` writes.

3. **Composite foreign keys** make cross-tenant assignment *unrepresentable*:

   ```sql
   FOREIGN KEY (assigned_user_id, company_id) REFERENCES users(id, company_id)
   ```

   A lead cannot be assigned to a user in another company even if application
   code has a bug. The same constraint covers tickets, ticket teams and
   conversations.

4. **Cascading deletes** from `companies`, so removing a tenant removes its data
   and no orphan outlives it.

Nothing reads a company id from a request body, anywhere.

---

## Authentication

- **Access token** — JWT, 15 minutes, sent as `Authorization: Bearer`. Algorithm
  is pinned to HS256, which closes the `alg: none` and HS/RS confusion attacks.
- **Refresh token** — opaque random string in an httpOnly, `SameSite=Strict`
  cookie scoped to `/api/v1/auth`. Only its SHA-256 digest is stored, so a
  database dump cannot be replayed as a login.
- **Rotation with reuse detection** — every refresh token is single-use.
  Presenting one that has already been rotated means it leaked, so the whole
  session family is revoked rather than merely refused.
- **Permissions are read from the database on every request**, not baked into
  the token. A JWT is valid until it expires, so permissions carried inside one
  would take a full token lifetime to revoke — meaning revoking access would not
  actually revoke it.
- **Uniform failures** — a wrong password and an unknown address return the same
  message and do the same amount of work (a throwaway hash comparison runs when
  no user matched), so the endpoint is not an account-enumeration oracle.
- **Lockout** — eight consecutive failures locks an account for fifteen minutes.
- The API authenticates by *header*, never by cookie, which is what makes the
  whole surface CSRF-resistant.

---

## Authorization

The permission catalog in `src/core/permissions.ts` mirrors the frontend's copy.
That duplication is deliberate: the frontend copy hides buttons, this copy
decides what happens. If they drift, the server wins.

Permissions are `resource.action` (`leads.assign`) and imply weaker ones —
granting `leads.edit` grants `leads.view`. Routes declare what they need:

```ts
leadsRouter.post("/:leadId/assign", requirePermission("leads.assign"), …)
```

A super admin holds every permission on platform routes. Inside a company
workspace they take on *that company's* administrator permissions, so their
actions are expressible in the workspace's own model and read the same in its
audit trail as anyone else's.

---

## What is left to the AI layer

`src/ai/ai-gateway.ts` declares the interface and nothing else. The default
implementation throws `501 ai_layer_not_implemented` for every capability.

Not implemented, by design:

- document text extraction, chunking and embedding
- vector storage and semantic retrieval (RAG)
- LLM orchestration, prompting, streaming
- tool calling and agent loops
- intent classification and confidence scoring
- website crawling and AI-suggested onboarding content

A stub that returned a keyword match dressed up as a similarity score, or a
canned paragraph presented as a generated answer, would make the product look
finished while lying about what it does. The endpoints that depend on the AI
layer say so instead:

| Endpoint                              | Behaviour without the AI layer                  |
| ------------------------------------- | ----------------------------------------------- |
| `POST /knowledge/retrieval-test`       | `answered: false` + a reason naming the gap     |
| `GET /analytics/ai`                    | `501` — every figure measures the AI layer      |
| `POST /wizard/analyze-website`         | `501`                                           |
| `POST /widget/:key/ask`                | `needs_ai_backend` when FAQ and catalogue miss  |
| Knowledge documents                    | stay `pending`; `vectorCount` stays 0           |

**What is already real and needs no AI:** FAQ search (Postgres full-text over
curated answers), product search, lead and ticket creation, assignment,
notifications, analytics over actual rows, and every workflow the widget drives
— including the conversation itself. Every widget exchange is written to
`conversations` and `messages` as it happens, so the inbox shows what real
visitors actually said, a handoff lands in the agent queue, and a lead or ticket
raised from a chat links back to the thread it came out of.

A widget conversation starts anonymous: `conversations.customer_id` is null
until the visitor submits a lead or a ticket, at which point the thread is
attached to that customer. Creating a placeholder customer per visitor would
fill the directory with empty records from bounces and bots.

To add the layer: implement `AIGateway` and call `registerAIGateway()` at boot.
No call site changes. **See [AI-LAYER.md](./AI-LAYER.md)** for the method-by-method
guide, and `src/ai/example/gateway.example.ts` for a skeleton to copy.

---

## Security notes

- Helmet with a maximally restrictive CSP — this process serves JSON and files,
  never HTML.
- CORS is an explicit allowlist, not a reflector.
- 1 MB JSON body cap; uploads capped separately and validated on both MIME type
  *and* extension, because the browser-supplied content type is a claim.
- Uploaded files are stored under random names (never the uploader's) in a
  per-tenant directory, and served only as `Content-Disposition: attachment`
  with `nosniff` — a stored HTML or SVG upload must never render inline.
- Two rate-limit tiers; the auth tier is keyed on the email being tried as well
  as the source address, so distributed guessing against one account is still
  throttled.
- `sortBy` is resolved against a column whitelist; search terms have LIKE
  wildcards escaped; every value is a bound parameter.
- Errors return a stable `{ status, code, message, fieldErrors? }` shape with a
  request id. Unexpected errors log in full and tell the client nothing —
  a stack trace helps an attacker and tells the user nothing they can act on.
