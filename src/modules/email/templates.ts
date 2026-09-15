import { env } from "../../config/env";

/**
 * The new-lead notification.
 *
 * Written so a salesperson can act on it without opening the dashboard: who it
 * is, how to reach them, what they asked for, and anything they were asked in
 * the process. A notification that only says "you have a new lead" makes the
 * reader go and look, which is the work it was supposed to save.
 *
 * Both a text and an HTML part, because a message with no text alternative is
 * one of the things spam filters weigh.
 */

export interface LeadMail {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  companyName?: string;
  interest: string;
  qualification: Array<{ question: string; answer: string }>;
  leadId: string;
  source: string;
}

export function leadEmail(lead: LeadMail): { subject: string; text: string; html: string } {
  const link = `${env.APP_ORIGIN}/company/leads/${lead.leadId}`;

  const rows: Array<[string, string]> = [
    ["Reference", lead.reference],
    ["Name", lead.customerName],
    ["Email", lead.customerEmail],
    ...(lead.customerPhone ? ([["Phone", lead.customerPhone]] as Array<[string, string]>) : []),
    ...(lead.companyName ? ([["Company", lead.companyName]] as Array<[string, string]>) : []),
    ["Source", lead.source],
  ];

  const text = [
    `New lead: ${lead.reference}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Interested in:",
    lead.interest,
    ...(lead.qualification.length > 0
      ? ["", "They also told us:", ...lead.qualification.map((entry) => `- ${entry.question} ${entry.answer}`)]
      : []),
    "",
    `Open the lead: ${link}`,
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2430;max-width:560px">
  <p style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:0 0 4px">New lead</p>
  <h1 style="font-size:22px;margin:0 0 18px">${escape(lead.reference)}</h1>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    ${rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;white-space:nowrap">${escape(label)}</td><td style="padding:6px 0">${escape(value)}</td></tr>`,
      )
      .join("")}
  </table>
  <p style="margin:18px 0 6px;color:#6b7280;font-size:13px">Interested in</p>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.5">${escape(lead.interest)}</p>
  ${
    lead.qualification.length > 0
      ? `<p style="margin:0 0 6px;color:#6b7280;font-size:13px">They also told us</p><ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.6">${lead.qualification
          .map((entry) => `<li><strong>${escape(entry.question)}</strong> ${escape(entry.answer)}</li>`)
          .join("")}</ul>`
      : ""
  }
  <p style="margin:0"><a href="${escape(link)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Open the lead</a></p>
</div>`.trim();

  return { subject: `New lead ${lead.reference} — ${truncate(lead.interest, 60)}`, text, html };
}

/** A customer's own words end up in this HTML, so they are escaped, not trusted. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}
