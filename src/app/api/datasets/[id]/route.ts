import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteDataset, getDataset } from "@/lib/server/repository";
const idOf = (request: Request) =>
  z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async (request) =>
  json({
    dataset: await getDataset(await requireSession(request), idOf(request)),
  }),
);
export const DELETE = route(async (request) => {
  await deleteDataset(await requireSession(request), idOf(request));
  return json({ deleted: true });
});
