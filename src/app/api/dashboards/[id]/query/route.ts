import { z } from "zod";
import { scalarSchema } from "@/lib/domain/schema";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { queryDashboard } from "@/lib/server/dashboard-query";
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  const input = await body(
    request,
    z.strictObject({
      filters: z.record(
        z.string().max(120),
        z.union([scalarSchema, z.array(scalarSchema).max(200)]),
      ),
    }),
  );
  const { results, datasets } = await queryDashboard(ctx, id, input.filters);
  return json({
    results,
    updatedAt: new Date().toISOString(),
    datasets: datasets.map((dataset) => ({
      id: dataset.id,
      updatedAt: dataset.updatedAt,
      version: dataset.version,
    })),
  });
});
