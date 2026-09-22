import { z } from "zod";
import { dashboardSchema } from "@/lib/domain/schema";
import { requireSession } from "@/lib/server/auth";
import { body, json, route } from "@/lib/server/http";
import {
  deleteDashboard,
  getDashboard,
  updateDashboard,
} from "@/lib/server/repository";
import { queryDashboard } from "@/lib/server/dashboard-query";
const idOf = (request: Request) =>
  z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async (request) =>
  json(await queryDashboard(await requireSession(request), idOf(request))),
);
export const PATCH = route(async (request) => {
  const ctx = await requireSession(request);
  const id = idOf(request);
  const input = await body(
    request,
    z.strictObject({
      spec: dashboardSchema.optional(),
      expectedVersion: z.number().int().positive(),
      pinned: z.boolean().optional(),
      reason: z
        .enum([
          "save",
          "autosave",
          "explicit_save",
          "remove_widget",
          "add_note",
          "layout",
          "undo",
          "redo",
          "edit_widget",
        ])
        .optional(),
    }),
  );
  const spec = input.spec ?? (await getDashboard(ctx, id)).spec;
  return json({
    dashboard: await updateDashboard(ctx, id, { ...input, spec }),
  });
});
export const DELETE = route(async (request) => {
  await deleteDashboard(await requireSession(request), idOf(request));
  return json({ deleted: true });
});
