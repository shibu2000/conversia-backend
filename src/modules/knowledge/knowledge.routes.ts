import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import { documentUpload, handleUploadError } from "../uploads/upload.middleware";
import * as controller from "./knowledge.controller";
import {
  createCollectionSchema,
  retrievalTestSchema,
  updateCollectionSchema,
  updateSourceSchema,
} from "./knowledge.schema";

/**
 * Knowledge Base: ingested documents and their processing state.
 *
 * Separate from FAQ throughout — this module manages sources and files, while
 * FAQ manages answers a person wrote. The chatbot config selects from each
 * independently.
 */
export const knowledgeRouter: Router = Router({ mergeParams: true });

knowledgeRouter.use(companyScope);

knowledgeRouter.get("/collections", requirePermission("knowledge.view"), asyncHandler(controller.listCollections));
knowledgeRouter.post(
  "/collections",
  requirePermission("knowledge.edit"),
  validateBody(createCollectionSchema),
  asyncHandler(controller.createCollection),
);
knowledgeRouter.patch(
  "/collections/:collectionId",
  requirePermission("knowledge.edit"),
  validateBody(updateCollectionSchema),
  asyncHandler(controller.updateCollection),
);

// Refuses while the collection still holds sources — see the service.
knowledgeRouter.delete(
  "/collections/:collectionId",
  requirePermission("knowledge.delete"),
  asyncHandler(controller.deleteCollection),
);

knowledgeRouter.get("/sources", requirePermission("knowledge.view"), asyncHandler(controller.listSources));
// Multer runs after the permission check, so an unauthorised caller cannot make
// this process buffer a file at all.
knowledgeRouter.post(
  "/sources",
  requirePermission("knowledge.upload"),
  (req, res, next) => documentUpload.array("files", 10)(req, res, (error) => next(handleUploadError(error))),
  asyncHandler(controller.createSource),
);
knowledgeRouter.get("/sources/:sourceId", requirePermission("knowledge.view"), asyncHandler(controller.getSource));
knowledgeRouter.patch(
  "/sources/:sourceId",
  requirePermission("knowledge.edit"),
  validateBody(updateSourceSchema),
  asyncHandler(controller.updateSource),
);
knowledgeRouter.post("/sources/:sourceId/reindex", requirePermission("knowledge.reindex"), asyncHandler(controller.reindexSource));
knowledgeRouter.delete("/sources/:sourceId", requirePermission("knowledge.delete"), asyncHandler(controller.deleteSource));

knowledgeRouter.get("/documents", requirePermission("knowledge.view"), asyncHandler(controller.listDocuments));
knowledgeRouter.get("/documents/:documentId", requirePermission("knowledge.view"), asyncHandler(controller.getDocument));
knowledgeRouter.get("/documents/:documentId/chunks", requirePermission("knowledge.view"), asyncHandler(controller.getDocumentChunks));
knowledgeRouter.get("/documents/:documentId/download", requirePermission("knowledge.view"), asyncHandler(controller.downloadDocument));
knowledgeRouter.post(
  "/documents/:documentId/reindex",
  requirePermission("knowledge.reindex"),
  asyncHandler(controller.reindexDocument),
);
knowledgeRouter.delete("/documents/:documentId", requirePermission("knowledge.delete"), asyncHandler(controller.deleteDocument));

knowledgeRouter.post(
  "/retrieval-test",
  requirePermission("knowledge.view"),
  validateBody(retrievalTestSchema),
  asyncHandler(controller.retrievalTest),
);
