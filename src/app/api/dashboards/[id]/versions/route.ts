import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { dashboardVersions } from "@/lib/server/repository";
export const GET = route(async (request) =>
  json({
    versions: await dashboardVersions(
      await requireSession(request),
      z.uuid().parse(new URL(request.url).pathname.split("/").at(-2)),
    ),
  }),
);
