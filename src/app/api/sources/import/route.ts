import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { importConnectedSource } from "@/lib/server/connectors";

export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const input = await body(
    request,
    z.strictObject({
      connectionId: z.uuid(),
      selection: z.string().trim().min(3).max(128),
    }),
  );
  return json(
    {
      dataset: await importConnectedSource(
        ctx,
        input.connectionId,
        input.selection,
      ),
    },
    201,
  );
});
