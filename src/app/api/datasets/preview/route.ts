import { randomUUID } from "node:crypto";
import { z } from "zod";
import { profileCsv } from "@/lib/domain/profiling";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/security";
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  rateLimit(`preview:${ctx.user.id}`, 15);
  const input = await body(
    request,
    z.strictObject({
      csv: z
        .string()
        .min(1)
        .max(10 * 1024 * 1024),
      name: z.string().min(1).max(120).optional(),
    }),
  );
  const dataset = profileCsv(input.csv, {
    id: randomUUID(),
    workspaceId: ctx.workspace.id,
    sourceId: randomUUID(),
    name: input.name ?? "CSV preview",
  });
  return json({ preview: { ...dataset, rows: dataset.rows.slice(0, 20) } });
});
