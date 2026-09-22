import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError, assertSameOrigin } from "./security";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 12 * 1024 * 1024,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Send a JSON request.");
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new HttpError(413, "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "The request body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "The request is too large.");
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request contains invalid JSON.");
  }
  return schema.parse(parsed);
}

export function route(fn: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const correlationId = randomUUID();
    try {
      assertSameOrigin(request);
      const response = await fn(request);
      const headers = new Headers(response.headers);
      headers.set("X-Request-Id", correlationId);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      let status = 500;
      let message = "The request could not be completed. Please try again.";
      let code = "internal_error";
      if (error instanceof HttpError) {
        status = error.status;
        message = error.message;
        code = error.code;
      } else if (error instanceof Error && error.name === "DomainError") {
        status = 400;
        message = error.message;
        code = "invalid_domain_input";
      } else if (error instanceof z.ZodError) {
        status = 400;
        message = error.issues
          .slice(0, 3)
          .map(
            (issue) => `${issue.path.join(".") || "Request"}: ${issue.message}`,
          )
          .join("; ");
        code = "validation_failed";
      } else if (
        error instanceof Error &&
        ["ECONNREFUSED", "CONNECTION_CLOSED", "CONNECT_TIMEOUT"].some(
          (value) => String((error as { code?: string }).code) === value,
        )
      ) {
        status = 503;
        message =
          "The local database is unavailable. Start the local Supabase stack.";
        code = "database_unavailable";
      }
      // Deliberately omit messages, SQL, credentials, prompts and dataset values from logs.
      console.error(
        JSON.stringify({
          event: "request_failed",
          correlationId,
          status,
          code,
        }),
      );
      return Response.json(
        { error: { message, code, correlationId } },
        {
          status,
          headers: {
            "Cache-Control": "no-store",
            "X-Request-Id": correlationId,
          },
        },
      );
    }
  };
}
