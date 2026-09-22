import { configuration, getSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { assertCanWrite } from "@/lib/server/security";
import { z } from "zod";
export const GET = route(async (request) => {
  const session = await getSession(request);
  return json({
    user: session?.user ?? null,
    workspace: session?.workspace ?? null,
    config: configuration(),
  });
});
export const PATCH = route(async (request) => {
  const ctx = await requireSession(request);
  const input = await body(
    request,
    z.strictObject({
      workspaceName: z.string().trim().min(1).max(120).optional(),
      appearance: z.enum(["light", "dark", "system"]).optional(),
    }),
  );
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    if (input.workspaceName) {
      assertCanWrite(ctx.workspace.role);
      await sql`update workspaces set name=${input.workspaceName},updated_at=now() where id=${ctx.workspace.id}`;
    }
    if (input.appearance)
      await sql`update profiles set preferences=preferences || ${sql.json({ appearance: input.appearance })},updated_at=now() where id=${ctx.user.id}`;
  });
  return json({ saved: true });
});
