import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { finishGoogleSheetsConnection } from "@/lib/server/connectors/google-sheets";
import { HttpError } from "@/lib/server/security";

export const GET = route(async (request) => {
  const ctx = await requireSession(request);
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError)
    throw new HttpError(
      401,
      "Google Sheets access was not granted.",
      "sheets_authorization_denied",
    );
  const state = z
    .string()
    .min(20)
    .max(500)
    .parse(url.searchParams.get("state"));
  const code = z.string().min(10).max(4096).parse(url.searchParams.get("code"));
  const result = await finishGoogleSheetsConnection(ctx, state, code);
  const destination = new URL(
    "/data",
    process.env.APP_URL ?? request.url,
  );
  destination.searchParams.set("sheets", result.connectionId);
  return Response.redirect(destination, 303);
});
