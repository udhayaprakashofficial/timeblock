import { randomBytes } from 'crypto';

/** Compact unique id (cuid-like) for rows inserted via Supabase REST. */
export function createId(prefix = 'c'): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}
