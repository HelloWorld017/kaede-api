import type { Context } from 'hono';
import type { z } from 'zod';
import type { Bindings } from '@/utils/config';

type Schemas = { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
type RequestData<T extends Schemas> = {
  [K in keyof T]: T[K] extends z.ZodType ? z.output<T[K]> : never;
};

export type Handler<T extends Schemas = any> = {
  method: 'get' | 'post' | 'delete';
  path: string;
  request?: T;
  handle: (
    c: Context<{ Bindings: Bindings }>,
    request: RequestData<T>,
  ) => Response | Promise<Response>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

export const route = <const T extends Schemas>(definition: Handler<T>) => definition;
export const response = (body: unknown, status = 200) => Response.json(body, { status });
