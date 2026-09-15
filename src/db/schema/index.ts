/**
 * The full schema, re-exported as one namespace.
 *
 * `drizzle(client, { schema })` needs every table and relation in a single
 * object for the relational query builder to resolve joins, and drizzle-kit
 * reads this file to generate migrations.
 */
export * from "./enums";
export * from "./custom-types";
export * from "./companies";
export * from "./users";
export * from "./customers";
export * from "./products";
export * from "./conversations";
export * from "./leads";
export * from "./tickets";
export * from "./faqs";
export * from "./knowledge";
export * from "./chatbot";
export * from "./platform";
