import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { duplicateDashboard } from "@/lib/server/repository";

export const POST = route(async (request) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));
  return json(
    { dashboard: await duplicateDashboard(await requireSession(request), id) },
    201,
  );
});
