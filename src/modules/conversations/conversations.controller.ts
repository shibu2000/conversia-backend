import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import { conversationViewSchema } from "./conversations.schema";
import * as service from "./conversations.service";

export async function list(req: Request, res: Response): Promise<void> {
  const view = conversationViewSchema.catch("all").parse(req.query.view);
  sendData(
    res,
    await service.listConversations(companyIdOf(req), authOf(req), parseListQuery(req, { pageSize: 30 }), view),
  );
}

export async function viewCounts(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getViewCounts(companyIdOf(req), authOf(req)));
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getConversation(companyIdOf(req), req.params.conversationId));
}

export async function messages(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getMessages(companyIdOf(req), req.params.conversationId));
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  sendData(
    res,
    await service.sendAgentMessage(companyIdOf(req), authOf(req), req.params.conversationId, req.body),
    201,
  );
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateConversation(companyIdOf(req), req.params.conversationId, req.body));
}

export async function assign(req: Request, res: Response): Promise<void> {
  sendData(res, await service.assignConversation(companyIdOf(req), req.params.conversationId, req.body.userId));
}

/** Step into a live conversation; the assistant stands down. */
export async function takeOver(req: Request, res: Response): Promise<void> {
  sendData(res, await service.takeOver(companyIdOf(req), authOf(req), req.params.conversationId));
}

/** Hand it back to the assistant. */
export async function release(req: Request, res: Response): Promise<void> {
  sendData(res, await service.releaseToAssistant(companyIdOf(req), authOf(req), req.params.conversationId));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteConversation(companyIdOf(req), req.params.conversationId);
  sendNoContent(res);
}
