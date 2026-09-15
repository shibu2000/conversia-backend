import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import * as service from "./users.service";

export async function list(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listUsers(companyIdOf(req), parseListQuery(req, { sortBy: "name", sortDir: "asc" })));
}

export async function listAll(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listAllUsers(parseListQuery(req, { sortBy: "name", sortDir: "asc" })));
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getUser(companyIdOf(req), req.params.userId));
}

export async function invite(req: Request, res: Response): Promise<void> {
  sendData(res, await service.inviteUser(companyIdOf(req), authOf(req), req.body), 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateUser(companyIdOf(req), req.params.userId, req.body));
}

export async function changeRole(req: Request, res: Response): Promise<void> {
  sendData(res, await service.changeRole(companyIdOf(req), authOf(req), req.params.userId, req.body.roleId));
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  sendData(res, await service.setStatus(companyIdOf(req), authOf(req), req.params.userId, req.body.status));
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  await service.resendInvite(companyIdOf(req), req.params.userId);
  sendNoContent(res);
}

export async function activity(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getUserActivity(companyIdOf(req), req.params.userId));
}

export async function assignable(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listAssignableUsers(companyIdOf(req)));
}

export async function listRoles(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listRoles(companyIdOf(req)));
}

export async function createRole(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createRole(companyIdOf(req), req.body), 201);
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateRole(companyIdOf(req), req.params.roleId, req.body));
}

export async function updateRolePermissions(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateRolePermissions(companyIdOf(req), req.params.roleId, req.body.permissions));
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  await service.deleteRole(companyIdOf(req), req.params.roleId);
  sendNoContent(res);
}

export async function listTeams(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listTeams(companyIdOf(req)));
}

export async function createTeam(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createTeam(companyIdOf(req), req.body), 201);
}
