import type { AuthContext } from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      /**
       * The authenticated principal. Populated by `authenticate`, and the only
       * source of truth for which company the caller may touch.
       */
      auth?: AuthContext;
      /** The company this request operates on, resolved by `companyScope`. */
      companyId?: string;
    }
  }
}

export {};
