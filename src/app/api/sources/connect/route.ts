import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { connectPostgres } from "@/lib/server/connectors/postgres";
import { beginGoogleSheetsConnection } from "@/lib/server/connectors/google-sheets";
import { rateLimit } from "@/lib/server/security";

const postgresql = z.strictObject({
  kind: z.literal("postgresql"),
  host: z.string().trim().min(1).max(253),
  port: z.string().trim().max(5).optional(),
  database: z.string().trim().min(1).max(63),
  user: z.string().trim().min(1).max(63),
  password: z.string().min(1).max(2048),
  ssl: z.enum(["require", "disable"]).optional(),
  refreshIntervalSeconds: z.coerce.number().int().min(30).max(3600),
});
const sheets = z.strictObject({
  kind: z.literal("google_sheets"),
  spreadsheet: z.string().trim().min(1).max(2048),
  refreshIntervalSeconds: z.coerce.number().int().min(30).max(3600),
});
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  rateLimit(`connector:${ctx.user.id}`, 10);
  const input = await body(
    request,
    z.discriminatedUnion("kind", [postgresql, sheets]),
  );
  if (input.kind === "google_sheets")
    return json(
      await beginGoogleSheetsConnection(
        ctx,
        input.spreadsheet,
        input.refreshIntervalSeconds,
      ),
    );
  return json(await connectPostgres(ctx, input));
});
