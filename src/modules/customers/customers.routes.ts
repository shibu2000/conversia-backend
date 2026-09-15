import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./customers.controller";
import { createCustomerSchema, updateCustomerSchema } from "./customers.schema";

export const customersRouter: Router = Router({ mergeParams: true });

customersRouter.use(companyScope);

customersRouter.get("/", requirePermission("customers.view"), asyncHandler(controller.list));
customersRouter.get("/filter-options", requirePermission("customers.view"), asyncHandler(controller.filterOptions));
customersRouter.post("/", requirePermission("customers.create"), validateBody(createCustomerSchema), asyncHandler(controller.create));
customersRouter.get("/:customerId", requirePermission("customers.view"), asyncHandler(controller.get));
customersRouter.get("/:customerId/profile", requirePermission("customers.view"), asyncHandler(controller.profile));
customersRouter.patch(
  "/:customerId",
  requirePermission("customers.edit"),
  validateBody(updateCustomerSchema),
  asyncHandler(controller.update),
);
customersRouter.delete("/:customerId", requirePermission("customers.delete"), asyncHandler(controller.remove));
