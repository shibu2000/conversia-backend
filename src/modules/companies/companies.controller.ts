import type { Request, Response } from "express";
import { parseListQuery } from "../../core/list-query";
import { sendData } from "../../core/http";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import * as service from "./companies.service";

export async function list(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listCompanies(parseListQuery(req, { sortBy: "name", sortDir: "asc" })));
}

/** Provision a company and invite its first administrator. */
export async function create(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createCompany(authOf(req), req.body), 201);
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getCompany(req.params.companyId));
}

/** The workspace reading its own company record — scoped to the session. */
export async function getOwn(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getCompany(companyIdOf(req)));
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateCompany(companyIdOf(req), req.body));
}

/** Platform-side edit, which may also change plan and status. */
export async function updateAsPlatform(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateCompany(req.params.companyId, req.body));
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateCompany(req.params.companyId, { status: req.body.status }));
}

export async function getSettings(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getSettings(companyIdOf(req)));
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateSettings(companyIdOf(req), req.body));
}

export async function filterOptions(_req: Request, res: Response): Promise<void> {
  sendData(res, await service.filterOptions());
}

export async function testEmail(req: Request, res: Response): Promise<void> {
  sendData(res, await service.sendTestEmail(companyIdOf(req), req.body.to));
}
