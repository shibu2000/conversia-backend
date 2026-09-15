import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { companyIdOf } from "../../middleware/company-scope";
import * as service from "./faqs.service";

export async function listSets(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listSets(companyIdOf(req)));
}

export async function getSet(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getSet(companyIdOf(req), req.params.setId));
}

export async function createSet(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createSet(companyIdOf(req), req.body), 201);
}

export async function updateSet(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateSet(companyIdOf(req), req.params.setId, req.body));
}

export async function deleteSet(req: Request, res: Response): Promise<void> {
  await service.deleteSet(companyIdOf(req), req.params.setId);
  sendNoContent(res);
}

export async function getTree(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getTree(companyIdOf(req), req.params.setId));
}

export async function listQuestions(req: Request, res: Response): Promise<void> {
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
  sendData(res, await service.listQuestions(companyIdOf(req), req.params.setId, categoryId));
}

export async function getQuestion(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getQuestion(companyIdOf(req), req.params.faqId));
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createCategory(companyIdOf(req), req.body), 201);
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateCategory(companyIdOf(req), req.params.categoryId, req.body));
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  await service.deleteCategory(companyIdOf(req), req.params.categoryId);
  sendNoContent(res);
}

export async function createQuestion(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createQuestion(companyIdOf(req), req.body), 201);
}

export async function updateQuestion(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateQuestion(companyIdOf(req), req.params.faqId, req.body));
}

export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  await service.deleteQuestion(companyIdOf(req), req.params.faqId);
  sendNoContent(res);
}

export async function move(req: Request, res: Response): Promise<void> {
  const { draggedId, targetId, position } = req.body;
  await service.moveNode(companyIdOf(req), draggedId, targetId, position);
  sendNoContent(res);
}
