import { checkDatabase } from '@/lib/db/health';

// Liveness + readiness endpoint for the host (SPEC.md §16) and the container fallback.
export const dynamic = 'force-dynamic';

export async function GET() {
  const database = await checkDatabase();
  return Response.json(
    { ok: database.ok, database },
    { status: database.ok ? 200 : 503 },
  );
}
