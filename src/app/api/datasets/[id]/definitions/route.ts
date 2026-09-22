import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { addDefinition } from "@/lib/server/repository";
import { withTenant } from "@/lib/server/db";
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  const input = await body(
    request,
    z.strictObject({
      title: z.string().trim().min(1).max(200),
      content: z.string().trim().min(1).max(20_000),
    }),
  );
  return json({ definition: await addDefinition(ctx, id, input) }, 201);
});
export const GET = route(async (request) => {
  const ctx = await requireSession(request);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  const definitions = await withTenant(
    ctx.user.id,
    ctx.workspace.id,
    (sql) =>
      sql`select id,title,content,status from knowledge_documents where workspace_id=${ctx.workspace.id} and dataset_id=${id} and kind='business_definition' order by updated_at desc`,
  );
  return json({ definitions });
});
