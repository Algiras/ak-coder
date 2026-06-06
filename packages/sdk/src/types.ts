import { z } from 'zod';

export interface ToolDefinition<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  outputSchema?: z.ZodTypeAny;
  handler: (args: z.infer<TSchema>) => Promise<any> | any;
}
