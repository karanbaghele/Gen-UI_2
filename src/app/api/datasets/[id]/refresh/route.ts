import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { refreshConnectedDataset } from "@/lib/server/connectors";
import { rateLimit } from "@/lib/server/security";

export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  rateLimit(`refresh:${ctx.user.id}`, 12);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  return json({ dataset: await refreshConnectedDataset(ctx, id) });
});
