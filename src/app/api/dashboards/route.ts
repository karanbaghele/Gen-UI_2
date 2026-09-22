import { z } from "zod";
import { dashboardSchema } from "@/lib/domain/schema";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { createDashboard, listDashboards } from "@/lib/server/repository";
export const GET = route(async (request) =>
  json({ dashboards: await listDashboards(await requireSession(request)) }),
);
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const input = await body(request, z.strictObject({ spec: dashboardSchema }));
  return json({ dashboard: await createDashboard(ctx, input) }, 201);
});
