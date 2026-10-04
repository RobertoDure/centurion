import { z } from 'zod';

/**
 * A JSON-serialisable value. This is the wire format for every external
 * boundary (Kafka message value, HTTP body, JSONB column, Jev state).
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
export const jsonArraySchema: z.ZodType<JsonArray> = z.array(jsonValueSchema);

/**
 * Jev's `Description` type: a string, an object or an array of values.
 * Rendered literally into the model prompt, so it must be JSON-serialisable.
 */
export type Description = string | JsonObject | JsonArray;

export const descriptionSchema: z.ZodType<Description> = z.union([
  z.string(),
  jsonObjectSchema,
  jsonArraySchema,
]);
