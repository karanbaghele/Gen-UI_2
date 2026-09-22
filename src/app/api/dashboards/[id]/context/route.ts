import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { dashboardContext } from "@/lib/server/repository";

const idOf = (request: Request) =>
  z.uuid().parse(new URL(request.url).pathname.split("/").at(-2));

export const GET = route(async (request) =>
  json({ context: await dashboardContext(await requireSession(request), idOf(request)) }),
);
