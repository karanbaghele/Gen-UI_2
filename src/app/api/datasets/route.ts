import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { createDataset, listDatasets } from "@/lib/server/repository";
import { rateLimit } from "@/lib/server/security";
export const GET = route(async (request) =>
  json({ datasets: await listDatasets(await requireSession(request)) }),
);
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  rateLimit(`import:${ctx.user.id}`, 10);
  const input = await body(
    request,
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("sample") }),
      z.strictObject({
        kind: z.literal("csv"),
        name: z.string().trim().min(1).max(120),
        csv: z
          .string()
          .min(1)
          .max(10 * 1024 * 1024),
      }),
    ]),
  );
  return json({ dataset: await createDataset(ctx, input) }, 201);
});
