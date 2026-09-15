import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import * as service from "./tickets.service";

export async function list(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listTickets(companyIdOf(req), parseListQuery(req, { sortBy: "createdAt" })));
}

export async function summary(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getSummary(companyIdOf(req)));
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getTicket(companyIdOf(req), req.params.ticketId));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createTicket(companyIdOf(req), authOf(req), req.body), 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateTicket(companyIdOf(req), authOf(req), req.params.ticketId, req.body));
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  sendData(res, await service.setStatus(companyIdOf(req), authOf(req), req.params.ticketId, req.body.status));
}

export async function assign(req: Request, res: Response): Promise<void> {
  sendData(
    res,
    await service.assignTicket(companyIdOf(req), authOf(req), req.params.ticketId, req.body.userId, req.body.teamId),
  );
}

export async function addReply(req: Request, res: Response): Promise<void> {
  sendData(res, await service.addReply(companyIdOf(req), authOf(req), req.params.ticketId, req.body), 201);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteTicket(companyIdOf(req), req.params.ticketId);
  sendNoContent(res);
}
