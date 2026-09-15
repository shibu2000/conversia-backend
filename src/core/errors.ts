/**
 * The error contract.
 *
 * The frontend's `ApiError` type is `{ status, code, message, fieldErrors? }`,
 * and its forms read `fieldErrors` to place messages next to inputs. Every
 * error thrown here serialises to exactly that shape.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export const badRequest = (message: string, fieldErrors?: Record<string, string>) =>
  new ApiError(400, "bad_request", message, fieldErrors);

export const unauthorized = (message = "Authentication is required.") => new ApiError(401, "unauthorized", message);

export const forbidden = (message = "You do not have permission to do that.") => new ApiError(403, "forbidden", message);

export const notFound = (entity: string, id?: string) =>
  new ApiError(404, "not_found", id ? `${entity} ${id} was not found.` : `${entity} was not found.`);

export const conflict = (message: string, fieldErrors?: Record<string, string>) =>
  new ApiError(409, "conflict", message, fieldErrors);

export const validationError = (message: string, fieldErrors?: Record<string, string>) =>
  new ApiError(422, "validation", message, fieldErrors);

export const immutable = (message: string) => new ApiError(422, "immutable", message);

export const payloadTooLarge = (message: string) => new ApiError(413, "payload_too_large", message);

/**
 * Raised at the AI seam.
 *
 * The AI layer is deliberately not implemented. This is how the API says so,
 * rather than returning a plausible-looking answer that no model produced.
 */
export const aiLayerNotImplemented = (capability: string) =>
  new ApiError(
    501,
    "ai_layer_not_implemented",
    `${capability} requires the AI layer, which is not enabled on this deployment.`,
  );
