import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./products.controller";
import { createProductCategorySchema, createProductSchema, updateProductSchema } from "./products.schema";

export const productsRouter: Router = Router({ mergeParams: true });

productsRouter.use(companyScope);

productsRouter.get("/products", requirePermission("products.view"), asyncHandler(controller.list));
productsRouter.post("/products", requirePermission("products.create"), validateBody(createProductSchema), asyncHandler(controller.create));
productsRouter.get("/products/:productId", requirePermission("products.view"), asyncHandler(controller.get));
productsRouter.patch(
  "/products/:productId",
  requirePermission("products.edit"),
  validateBody(updateProductSchema),
  asyncHandler(controller.update),
);
productsRouter.delete("/products/:productId", requirePermission("products.delete"), asyncHandler(controller.remove));

productsRouter.get("/product-categories", requirePermission("products.view"), asyncHandler(controller.listCategories));
productsRouter.post(
  "/product-categories",
  requirePermission("products.create"),
  validateBody(createProductCategorySchema),
  asyncHandler(controller.createCategory),
);
