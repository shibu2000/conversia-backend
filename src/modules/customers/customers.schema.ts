import { z } from "zod";

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
  country: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(16).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: z.enum(["active", "lead", "customer", "churned", "blocked"]).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
