import path from "node:path";
import multer from "multer";
import { env } from "../../config/env";
import { validationError } from "../../core/errors";

/**
 * Upload handling.
 *
 * In-memory storage with a hard size cap: nothing is written to disk until the
 * request has been authenticated, authorised and validated, so an unauthorised
 * caller cannot fill the volume. The MIME allowlist is paired with an extension
 * check because the browser-supplied content type is a claim, not a fact.
 */
const ALLOWED = new Map<string, string[]>([
  ["application/pdf", [".pdf"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", [".docx"]],
  ["application/msword", [".doc"]],
  ["text/plain", [".txt", ".md"]],
  ["text/markdown", [".md", ".txt"]],
  ["text/csv", [".csv"]],
  ["application/csv", [".csv"]],
  ["application/json", [".json"]],
  ["text/html", [".html", ".htm"]],
]);

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
    files: 10,
    // Caps the non-file parts too, so a multipart body cannot be used to
    // sidestep the JSON body limit.
    fields: 20,
    fieldSize: 100_000,
  },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ALLOWED.get(file.mimetype);

    if (!allowedExtensions) {
      callback(validationError(`Files of type ${file.mimetype} are not accepted.`, { files: "Unsupported file type." }));
      return;
    }
    if (!allowedExtensions.includes(extension)) {
      callback(
        validationError("That file's extension does not match its content type.", {
          files: "The file extension and type do not match.",
        }),
      );
      return;
    }
    callback(null, true);
  },
});

/** Translate multer's own errors into the standard API error shape. */
export function handleUploadError(error: unknown): unknown {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      const megabytes = Math.round(env.MAX_UPLOAD_BYTES / 1_048_576);
      return validationError(`Files must be ${megabytes} MB or smaller.`, { files: `Maximum size is ${megabytes} MB.` });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return validationError("Too many files in one upload.", { files: "Upload at most 10 files at a time." });
    }
    return validationError(error.message, { files: error.message });
  }
  return error;
}
