import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import { readFile } from "../uploads/storage.service";
import { createSourceSchema } from "./knowledge.schema";
import * as service from "./knowledge.service";

export async function listCollections(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listCollections(companyIdOf(req)));
}

export async function createCollection(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createCollection(companyIdOf(req), req.body), 201);
}

export async function updateCollection(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateCollection(companyIdOf(req), req.params.collectionId, req.body));
}

export async function deleteCollection(req: Request, res: Response): Promise<void> {
  await service.deleteCollection(companyIdOf(req), req.params.collectionId);
  sendNoContent(res);
}

export async function listSources(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listSources(companyIdOf(req), parseListQuery(req, { sortBy: "name", sortDir: "asc" })));
}

export async function getSource(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getSource(companyIdOf(req), req.params.sourceId));
}

/**
 * Create a source.
 *
 * Accepts both JSON and multipart. Multipart fields arrive as strings, so the
 * body is parsed through the same Zod schema after the nested `crawl` object is
 * reassembled from its bracketed field names.
 */
export async function createSource(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const raw = normaliseMultipartBody(req.body);
  const input = createSourceSchema.parse(raw);

  sendData(
    res,
    await service.createSource(
      companyIdOf(req),
      authOf(req),
      input,
      files.map((file) => ({ originalname: file.originalname, mimetype: file.mimetype, buffer: file.buffer })),
    ),
    201,
  );
}

export async function updateSource(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateSource(companyIdOf(req), req.params.sourceId, req.body));
}

export async function reindexSource(req: Request, res: Response): Promise<void> {
  sendData(res, await service.reindexSource(companyIdOf(req), req.params.sourceId));
}

export async function deleteSource(req: Request, res: Response): Promise<void> {
  await service.deleteSource(companyIdOf(req), req.params.sourceId);
  sendNoContent(res);
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
  sendData(res, await service.listDocuments(companyIdOf(req), parseListQuery(req), sourceId));
}

export async function getDocument(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getDocument(companyIdOf(req), req.params.documentId));
}

export async function getDocumentChunks(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getDocumentChunks(companyIdOf(req), req.params.documentId));
}

export async function reindexDocument(req: Request, res: Response): Promise<void> {
  sendData(res, await service.reindexDocument(companyIdOf(req), req.params.documentId));
}

export async function deleteDocument(req: Request, res: Response): Promise<void> {
  await service.deleteDocument(companyIdOf(req), req.params.documentId);
  sendNoContent(res);
}

/** Stream the original upload back. */
export async function downloadDocument(req: Request, res: Response): Promise<void> {
  const document = await service.getDocumentFile(companyIdOf(req), req.params.documentId);
  const buffer = await readFile(document.storageKey!);

  res.setHeader("Content-Type", document.mimeType);
  // `attachment` plus nosniff: the browser must never render an uploaded file
  // inline, which is how a stored HTML or SVG upload becomes stored XSS.
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(document.name)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

export async function retrievalTest(req: Request, res: Response): Promise<void> {
  sendData(res, await service.runRetrievalTest(companyIdOf(req), req.body));
}

/** Rebuild `crawl[rootUrl]`-style multipart fields into a nested object. */
function normaliseMultipartBody(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const crawl: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body ?? {})) {
    const match = /^crawl\[(\w+)\]$/.exec(key);
    if (match) {
      crawl[match[1]] = value;
      continue;
    }
    result[key] = value;
  }

  if (Object.keys(crawl).length > 0) result.crawl = crawl;
  if (typeof result.crawl === "string") {
    try {
      result.crawl = JSON.parse(result.crawl);
    } catch {
      delete result.crawl;
    }
  }
  return result;
}
