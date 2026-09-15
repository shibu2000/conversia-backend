import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { companyIdOf } from "../../middleware/company-scope";
import * as service from "./products.service";

export async function list(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listProducts(companyIdOf(req), parseListQuery(req, { sortBy: "name", sortDir: "asc" })));
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getProduct(companyIdOf(req), req.params.productId));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createProduct(companyIdOf(req), req.body), 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateProduct(companyIdOf(req), req.params.productId, req.body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteProduct(companyIdOf(req), req.params.productId);
  sendNoContent(res);
}

export async function listCategories(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listCategories(companyIdOf(req)));
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createCategory(companyIdOf(req), req.body), 201);
}
