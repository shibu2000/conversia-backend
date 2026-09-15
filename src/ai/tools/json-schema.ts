import { z } from "zod";

/**
 * A Zod object turned into the JSON Schema a model is given.
 *
 * Deliberately not a library. The tool arguments here are flat objects of
 * optional and required strings, and that is all this needs to describe —
 * a general converter would be a dependency carrying a specification's worth of
 * cases none of these tools use. The same schema still does the validating, so
 * anything this description gets wrong is caught when the call comes back.
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const shape = schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodTypeAny>) : {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const optional = field.isOptional();
    properties[key] = { type: "string", ...(field.description ? { description: field.description } : {}) };
    if (!optional) required.push(key);
  }

  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}
