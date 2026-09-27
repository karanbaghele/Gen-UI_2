import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request))
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });

  try {
    const sql = getDb();
    await sql`select 1 as alive`;
    return Response.json(
      { ok: true, checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ event: "database_health_failed" }));
    return Response.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
