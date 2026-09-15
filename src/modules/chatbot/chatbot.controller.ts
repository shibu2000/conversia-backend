import type { Request, Response } from "express";
import { env } from "../../config/env";
import { sendData } from "../../core/http";
import { authOf, companyIdOf } from "../../middleware/company-scope";
import * as service from "./chatbot.service";

export async function get(req: Request, res: Response): Promise<void> {
  const config = await service.getConfig(companyIdOf(req));
  const widgetOrigin = env.corsOrigins[0] ?? `http://localhost:${env.PORT}`;
  sendData(res, { ...config, embedSnippet: service.buildEmbedSnippet(config, widgetOrigin) });
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateConfig(companyIdOf(req), req.body));
}

export async function publish(req: Request, res: Response): Promise<void> {
  sendData(res, await service.publishConfig(companyIdOf(req), authOf(req)));
}

export async function versions(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listVersions(companyIdOf(req)));
}

export async function addDomain(req: Request, res: Response): Promise<void> {
  sendData(res, await service.addDomain(companyIdOf(req), req.body.domain), 201);
}

export async function removeDomain(req: Request, res: Response): Promise<void> {
  sendData(res, await service.removeDomain(companyIdOf(req), req.params.domain));
}

export async function rotateKey(req: Request, res: Response): Promise<void> {
  sendData(res, await service.rotateEmbedKey(companyIdOf(req), authOf(req)));
}
