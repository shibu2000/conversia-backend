import { and, eq, ilike, or, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db";
import { conversations, customers, faqSets, faqs, knowledgeDocuments, leads, products, tickets, users } from "../../db/schema";
import { asyncHandler, sendData } from "../../core/http";
import { likePattern } from "../../core/list-query";
import { companyIdOf, companyScope } from "../../middleware/company-scope";

/**
 * Global search — the ⌘K command menu's backend.
 *
 * Results are capped per entity type so no single type crowds the others out,
 * which matters most when the query is short and matches broadly. Every query
 * is scoped to the caller's company: search is the easiest place to
 * accidentally leak another tenant's data, because it touches every table at
 * once.
 */
export const searchRouter: Router = Router({ mergeParams: true });

searchRouter.use(companyScope);

interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  href: string;
  excerpt?: string;
  badge?: string;
}

searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = companyIdOf(req);
    const auth = req.auth!;
    const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const limit = Math.min(10, Math.max(1, Number.parseInt(String(req.query.limitPerType ?? "4"), 10) || 4));

    if (term.length < 1) {
      sendData(res, []);
      return;
    }

    const pattern = likePattern(term);
    const results: SearchResult[] = [];

    // Each block is gated on the permission that guards the module it links
    // into: search must not become a way to see records the UI would hide.
    const can = (permission: string) => auth.isSuperAdmin || auth.permissions.has(permission);

    if (can("customers.view")) {
      const rows = await db
        .select({ id: customers.id, name: customers.name, email: customers.email, country: customers.country, status: customers.status })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), or(ilike(customers.name, pattern), ilike(customers.email, pattern))))
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "customer",
          title: row.name,
          subtitle: row.email ?? row.country,
          href: `/company/customers/${row.id}`,
          badge: row.status,
        })),
      );
    }

    if (can("conversations.view")) {
      const rows = await db
        .select({
          id: conversations.id,
          reference: conversations.reference,
          subject: conversations.subject,
          preview: conversations.preview,
          customerName: customers.name,
        })
        .from(conversations)
        .leftJoin(customers, eq(customers.id, conversations.customerId))
        .where(
          and(
            eq(conversations.companyId, companyId),
            or(ilike(conversations.subject, pattern), ilike(conversations.preview, pattern), ilike(conversations.reference, pattern), ilike(customers.name, pattern)),
          ),
        )
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "conversation",
          title: `${row.customerName ?? "Website visitor"} — ${row.subject}`,
          subtitle: row.reference,
          href: `/company/conversations/${row.id}`,
          excerpt: row.preview.slice(0, 110),
        })),
      );
    }

    if (can("leads.view")) {
      const rows = await db
        .select({ id: leads.id, reference: leads.reference, interest: leads.interest, status: leads.status, customerName: customers.name })
        .from(leads)
        .innerJoin(customers, eq(customers.id, leads.customerId))
        .where(
          and(
            eq(leads.companyId, companyId),
            or(ilike(leads.reference, pattern), ilike(leads.interest, pattern), ilike(customers.name, pattern)),
          ),
        )
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "lead",
          title: `${row.reference} — ${row.customerName}`,
          subtitle: row.interest.slice(0, 70),
          href: `/company/leads/${row.id}`,
          badge: row.status,
        })),
      );
    }

    if (can("tickets.view")) {
      const rows = await db
        .select({ id: tickets.id, reference: tickets.reference, subject: tickets.subject, status: tickets.status, customerName: customers.name })
        .from(tickets)
        .innerJoin(customers, eq(customers.id, tickets.customerId))
        .where(
          and(
            eq(tickets.companyId, companyId),
            or(ilike(tickets.reference, pattern), ilike(tickets.subject, pattern), ilike(customers.name, pattern)),
          ),
        )
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "ticket",
          title: `${row.reference} — ${row.subject}`,
          subtitle: row.customerName,
          href: `/company/tickets/${row.id}`,
          badge: row.status,
        })),
      );
    }

    if (can("products.view")) {
      const rows = await db
        .select({ id: products.id, name: products.name, sku: products.sku, status: products.status })
        .from(products)
        .where(and(eq(products.companyId, companyId), or(ilike(products.name, pattern), ilike(products.sku, pattern))))
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "product",
          title: row.name,
          subtitle: row.sku,
          href: `/company/products/${row.id}`,
          badge: row.status,
        })),
      );
    }

    if (can("faq.view")) {
      // Full-text over the generated tsvector, with a trigram fallback so a
      // partial word still matches — `websearch_to_tsquery` alone would miss
      // "ship" typed while the reader is still typing "shipping".
      const rows = await db
        .select({ id: faqs.id, question: faqs.question, answer: faqs.answer, setId: faqs.setId, setName: faqSets.name })
        .from(faqs)
        .innerJoin(faqSets, eq(faqSets.id, faqs.setId))
        .where(
          and(
            eq(faqs.companyId, companyId),
            or(
              sql`${faqs.searchVector} @@ websearch_to_tsquery('english', ${term})`,
              ilike(faqs.question, pattern),
            ),
          ),
        )
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "faq",
          title: row.question,
          subtitle: row.setName,
          href: `/company/faqs?set=${row.setId}&node=${row.id}`,
          excerpt: row.answer.slice(0, 110),
        })),
      );
    }

    if (can("knowledge.view")) {
      const rows = await db
        .select({ id: knowledgeDocuments.id, name: knowledgeDocuments.name, status: knowledgeDocuments.status })
        .from(knowledgeDocuments)
        .where(and(eq(knowledgeDocuments.companyId, companyId), ilike(knowledgeDocuments.name, pattern)))
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "knowledge_document",
          title: row.name,
          subtitle: "Knowledge document",
          href: `/company/knowledge-base/documents/${row.id}`,
          badge: row.status,
        })),
      );
    }

    if (can("users.view")) {
      const rows = await db
        .select({ id: users.id, name: users.name, email: users.email, title: users.title, status: users.status })
        .from(users)
        .where(and(eq(users.companyId, companyId), or(ilike(users.name, pattern), ilike(users.email, pattern))))
        .limit(limit);

      results.push(
        ...rows.map((row) => ({
          id: row.id,
          type: "user",
          title: row.name,
          subtitle: row.title ?? row.email,
          href: `/company/users/${row.id}`,
          badge: row.status,
        })),
      );
    }

    sendData(res, results);
  }),
);
