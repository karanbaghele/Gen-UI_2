import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { previewConnectedSource } from "@/lib/server/connectors";
import { rateLimit } from "@/lib/server/security";

export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  rateLimit(`source-preview:${ctx.user.id}`, 20);
  const input = await body(
    request,
    z.strictObject({
      connectionId: z.uuid(),
      selection: z.string().trim().min(1).max(200),
    }),
    8 * 1024,
  );
  return json(
    await previewConnectedSource(ctx, input.connectionId, input.selection),
  );
});
