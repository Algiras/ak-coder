import { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const description = schema.description;
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, propSchema] of Object.entries(schema.shape)) {
      properties[key] = zodToJsonSchema(propSchema as z.ZodTypeAny);
      if (!(propSchema instanceof z.ZodOptional) && !(propSchema instanceof z.ZodNullable)) {
        required.push(key);
      }
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap());
    if (description && !inner.description) inner.description = description;
    return inner;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options, ...(description ? { description } : {}) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element), ...(description ? { description } : {}) };
  }
  const typeStr = schema instanceof z.ZodNumber ? 'number' : schema instanceof z.ZodBoolean ? 'boolean' : 'string';
  return { type: typeStr, ...(description ? { description } : {}) };
}
