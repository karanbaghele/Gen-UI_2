import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { restoreDashboard } from "@/lib/server/repository";
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  const input = await body(
    request,
    z.strictObject({
      version: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
    }),
  );
  return json({
    dashboard: await restoreDashboard(
      ctx,
      id,
      input.version,
      input.expectedVersion,
    ),
  });
});
