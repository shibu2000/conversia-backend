import { zodToJsonSchema } from "./json-schema";
import type { ToolDefinition } from "../providers";
import type { Tool } from "./types";

export * from "./types";
export { runTool, toolsFor } from "./registry";

/** Describe the enabled tools in the shape every provider takes. */
export function describeTools(tools: Tool<never>[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters),
  }));
}
