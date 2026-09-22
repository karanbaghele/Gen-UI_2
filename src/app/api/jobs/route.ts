import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { enqueueIndex, listIndexJobs, runDueJobs } from "@/lib/server/jobs";

export const GET = route(async (request) =>
  json({ jobs: await listIndexJobs(await requireSession(request)) }),
);
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const input = await body(
    request,
    z.strictObject({
      datasetId: z.uuid().optional(),
      run: z.boolean().optional(),
    }),
  );
  if (input.datasetId) await enqueueIndex(ctx, input.datasetId);
  return json({
    jobs: input.run
      ? await runDueJobs(ctx, 1, request.signal)
      : await listIndexJobs(ctx),
  });
});
