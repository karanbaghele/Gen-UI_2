import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, route } from "@/lib/server/http";
import { generateDashboard, generationStream } from "@/lib/server/generation";

const input = z.strictObject({
  datasetId: z.uuid(),
  prompt: z.string().trim().min(1).max(8_000),
  mode: z.enum(["demo", "ollama", "gemini"]).optional(),
});
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const value = await body(request, input, 32 * 1024);
  return generationStream(request, (signal, emit) =>
    generateDashboard({ ...value, ctx, signal, emit }),
  );
});
