import { describe, expect, it } from "vitest";
import { readGenerationStream } from "@/lib/client-stream";

describe("generation stream reader", () => {
  it("preserves HTTP status for conflict recovery", async () => {
    const response = Response.json(
      { error: { message: "A newer dashboard version exists." } },
      { status: 409 },
    );

    await expect(readGenerationStream(response, () => {})).rejects.toMatchObject(
      { message: "A newer dashboard version exists.", status: 409 },
    );
  });

  it("emits progress and returns only the completed result", async () => {
    const stages: string[] = [];
    const response = new Response(
      [
        JSON.stringify({ type: "progress", message: "Retrieving" }),
        JSON.stringify({ type: "result", dashboard: { id: "dashboard-1" } }),
      ].join("\n"),
    );

    await expect(
      readGenerationStream<{ type: "result"; dashboard: { id: string } }>(
        response,
        (stage) => stages.push(stage),
      ),
    ).resolves.toEqual({
      type: "result",
      dashboard: { id: "dashboard-1" },
    });
    expect(stages).toEqual(["Retrieving"]);
  });
});
