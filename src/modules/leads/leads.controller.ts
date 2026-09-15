import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import * as service from "./leads.service";

export async function list(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listLeads(companyIdOf(req), parseListQuery(req, { sortBy: "createdAt" })));
}

export async function summary(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getSummary(companyIdOf(req)));
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getLead(companyIdOf(req), req.params.leadId));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createLead(companyIdOf(req), authOf(req), req.body), 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateLead(companyIdOf(req), req.params.leadId, req.body));
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  sendData(
    res,
    await service.setStatus(companyIdOf(req), authOf(req), req.params.leadId, req.body.status, req.body.lostReason),
  );
}

export async function assign(req: Request, res: Response): Promise<void> {
  sendData(
    res,
    await service.assignLead(companyIdOf(req), authOf(req), req.params.leadId, req.body.userId, {
      method: req.body.method,
      reason: req.body.reason,
    }),
  );
}

export async function addNote(req: Request, res: Response): Promise<void> {
  sendData(res, await service.addNote(companyIdOf(req), authOf(req), req.params.leadId, req.body.body), 201);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteLead(companyIdOf(req), req.params.leadId);
  sendNoContent(res);
}
