import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { body, route } from "@/lib/server/http";
import { generationStream, refineDashboard } from "@/lib/server/generation";

const input = z.strictObject({
  dashboardId: z.uuid(),
  prompt: z.string().trim().min(1).max(8_000),
  expectedVersion: z.number().int().positive(),
  mode: z.enum(["demo", "ollama", "gemini"]).optional(),
});
export const POST = route(async (request) => {
  const ctx = await requireSession(request);
  const value = await body(request, input, 32 * 1024);
  return generationStream(request, (signal, emit) =>
    refineDashboard({ ...value, ctx, signal, emit }),
  );
});
