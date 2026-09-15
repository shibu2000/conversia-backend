import type { Request, Response } from "express";
import { sendData, sendNoContent } from "../../core/http";
import { parseListQuery } from "../../core/list-query";
import { companyIdOf } from "../../middleware/company-scope";
import * as service from "./customers.service";

export async function list(req: Request, res: Response): Promise<void> {
  sendData(res, await service.listCustomers(companyIdOf(req), parseListQuery(req, { sortBy: "name", sortDir: "asc" })));
}

export async function get(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getCustomer(companyIdOf(req), req.params.customerId));
}

/** The unified profile: customer, conversations, leads, tickets, orders, bookings. */
export async function profile(req: Request, res: Response): Promise<void> {
  sendData(res, await service.getCustomerProfile(companyIdOf(req), req.params.customerId));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendData(res, await service.createCustomer(companyIdOf(req), req.body), 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  sendData(res, await service.updateCustomer(companyIdOf(req), req.params.customerId, req.body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteCustomer(companyIdOf(req), req.params.customerId);
  sendNoContent(res);
}

export async function filterOptions(req: Request, res: Response): Promise<void> {
  sendData(res, await service.filterOptions(companyIdOf(req)));
}
