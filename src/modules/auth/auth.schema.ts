import { z } from "zod";

/**
 * Request shapes for the auth endpoints.
 *
 * Password rules follow current NIST guidance: length is what matters, so the
 * floor is 10 characters with no composition rules that push people towards
 * `Password1!`. The cap exists because bcrypt silently truncates past 72 bytes,
 * and a password that is longer than the algorithm reads is a false promise.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters. Length matters more than symbols.")
  .max(72, "Passwords are limited to 72 characters.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email("That does not look like a valid email address.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(72),
});

/** Sign-up creates a company and its first administrator in one transaction. */
export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: emailSchema,
  password: passwordSchema,
  companyName: z.string().trim().min(1, "Enter your company name.").max(160),
  website: z.string().trim().url("Enter a full URL, including https://").max(255).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(64).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

export const acceptInviteSchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(72),
  newPassword: passwordSchema,
});

/** A super admin entering or leaving a company workspace. */
export const impersonateSchema = z.object({ companyId: z.string().min(1).max(64) });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
