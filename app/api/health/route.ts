import { checkDatabase } from '@/lib/db/health';

// Liveness + readiness endpoint for whichever host is chosen (SPEC.md §15.4).
export const dynamic = 'force-dynamic';

export async function GET() {
  const database = await checkDatabase();
  return Response.json(
    { ok: database.ok, database },
    { status: database.ok ? 200 : 503 },
  );
}
