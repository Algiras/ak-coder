import { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const description = schema.description;

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    const shape = schema.shape;
    for (const [key, propSchema] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(propSchema as z.ZodTypeAny);
      if (!(propSchema instanceof z.ZodOptional) && !(propSchema instanceof z.ZodNullable)) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {})
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const unwrappedSchema = zodToJsonSchema(schema.unwrap());
    if (description && !unwrappedSchema.description) {
      unwrappedSchema.description = description;
    }
    return unwrappedSchema;
  }

  let typeStr = 'string';

  if (schema instanceof z.ZodString) {
    typeStr = 'string';
  } else if (schema instanceof z.ZodNumber) {
    typeStr = 'number';
  } else if (schema instanceof z.ZodBoolean) {
    typeStr = 'boolean';
  } else if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema.options,
      ...(description ? { description } : {})
    };
  } else if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element),
      ...(description ? { description } : {})
    };
  }

  return {
    type: typeStr,
    ...(description ? { description } : {})
  };
}
