/**
 * Postgres raises 22P02 on a malformed uuid, which surfaces as a 500 rather
 * than a readable rejection. Anything that puts a client-supplied id into a
 * query filters it through here first.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
