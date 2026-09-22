import { z } from "zod";
import { exportRowsCsv } from "@/lib/domain/query";
import { scalarSchema } from "@/lib/domain/schema";
import { requireSession } from "@/lib/server/auth";
import { body, route } from "@/lib/server/http";
import { queryDashboard } from "@/lib/server/dashboard-query";
import { HttpError } from "@/lib/server/security";
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  const input = await body(
    request,
    z.strictObject({
      queryId: z.string().min(1).max(120),
      filters: z
        .record(
          z.string().max(120),
          z.union([scalarSchema, z.array(scalarSchema).max(200)]),
        )
        .default({}),
    }),
  );
  const { results } = await queryDashboard(ctx, id, input.filters);
  const result = results[input.queryId];
  if (!result) throw new HttpError(404, "The requested query is unavailable.");
  return new Response(exportRowsCsv(result.rows, result.columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="genui-export.csv"',
      "Cache-Control": "no-store",
    },
  });
});
