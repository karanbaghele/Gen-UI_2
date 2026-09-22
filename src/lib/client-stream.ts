import { ApiError } from "./client";

type StreamObject = Record<string, unknown>;

function messageFrom(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const message = (value as StreamObject).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export async function readGenerationStream<T extends StreamObject>(
  response: Response,
  onProgress: (message: string) => void,
): Promise<T> {
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as StreamObject | null;
    throw new ApiError(
      messageFrom(
        payload?.error,
        `Request failed with status ${response.status}.`,
      ),
      response.status,
    );
  }
  if (!response.body) throw new Error("No generation response received.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;

  const consume = (line: string) => {
    if (!line.trim()) return;
    const item = JSON.parse(line) as StreamObject;
    if (item.type === "progress") {
      onProgress(
        messageFrom(item.message ?? item.stage, "Working on your dashboard"),
      );
    } else if (item.type === "error") {
      throw new Error(
        messageFrom(item.error, "Unable to complete this dashboard request."),
      );
    } else if (item.type === "result") {
      result = item as T;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!result)
    throw new Error(
      "Generation ended before a dashboard was saved. Please try again.",
    );
  return result;
}
