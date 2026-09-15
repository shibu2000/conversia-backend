import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { authenticate } from "../../middleware/authenticate";
import { requireSuperAdmin } from "../../middleware/authorize";
import { authLimiter } from "../../middleware/rate-limit";
import { validateBody } from "../../middleware/validate";
import * as controller from "./auth.controller";
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  impersonateSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schema";

/**
 * Auth routes.
 *
 * Everything that takes a credential — sign-in, sign-up, reset, invite
 * acceptance — sits behind the strict limiter, which is keyed on the address
 * being tried as well as the source address so guessing one account is
 * throttled even from many IPs.
 */
export const authRouter: Router = Router();

authRouter.post("/login", authLimiter, validateBody(loginSchema), asyncHandler(controller.login));
authRouter.post("/register", authLimiter, validateBody(registerSchema), asyncHandler(controller.register));
authRouter.post("/refresh", asyncHandler(controller.refresh));
authRouter.post("/logout", asyncHandler(controller.logout));

authRouter.post("/forgot-password", authLimiter, validateBody(forgotPasswordSchema), asyncHandler(controller.forgotPassword));
authRouter.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), asyncHandler(controller.resetPassword));
authRouter.post("/accept-invite", authLimiter, validateBody(acceptInviteSchema), asyncHandler(controller.acceptInvite));

authRouter.use(authenticate);

authRouter.get("/me", asyncHandler(controller.me));
authRouter.post("/logout-everywhere", asyncHandler(controller.logoutEverywhere));
authRouter.post("/change-password", validateBody(changePasswordSchema), asyncHandler(controller.changePassword));

authRouter.post("/impersonate", requireSuperAdmin, validateBody(impersonateSchema), asyncHandler(controller.impersonate));
authRouter.post("/stop-impersonating", requireSuperAdmin, asyncHandler(controller.stopImpersonating));
