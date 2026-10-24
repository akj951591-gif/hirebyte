import type { Request } from 'express';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';

const uuid = z.uuid();

/** Route ids are UUIDs; anything else is simply "not found". */
export function uuidParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !uuid.safeParse(value).success) throw Errors.notFound();
  return value;
}
