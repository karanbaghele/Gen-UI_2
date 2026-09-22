import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSampleDataset } from "@/lib/domain";
import {
  AiError,
  boundedResponseJson,
  localOllamaUrl,
  structuredOutput,
  type AiProvider,
} from "@/lib/server/ai";
import {
  datasetKnowledge,
  normalizeRequest,
  rankContext,
  vectorLiteral,
  type KnowledgeChunk,
} from "@/lib/server/rag";

function chunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: "chunk-1",
    documentId: "document-1",
    datasetId: "dataset-1",
    sourceType: "schema",
    title: "Schema",
    content: "Authorized metadata",
    checksum: "checksum-1",
    vectorScore: 0.8,
    lexicalScore: 0.4,
    updatedAt: "2026-09-10T00:00:00.000Z",
    score: 0,
    ...overrides,
  };
}

describe("RAG data boundaries", () => {
  it("normalizes prompts and embeds schema without raw row values", () => {
    const dataset = createSampleDataset("workspace-1", "dataset-1");
    const secretRowValue = String(dataset.rows[0].customer);
    const knowledge = datasetKnowledge(dataset).map((item) => item.content);

    expect(knowledge.join("\n")).not.toContain(secretRowValue);
    expect(knowledge.join("\n")).toContain('"fields"');
    expect(normalizeRequest(`  show\u0000 sales  `)).toBe("show sales");
    expect(normalizeRequest("x".repeat(8_100))).toHaveLength(8_000);
  });

  it("filters unselected datasets before ranking, dedupes, and enforces the budget", () => {
    const selected = chunk({ content: "a".repeat(20) });
    const duplicate = chunk({ id: "chunk-2", content: "duplicate" });
    const unselected = chunk({
      id: "chunk-3",
      datasetId: "dataset-2",
      checksum: "checksum-3",
      content: "must never be returned",
      vectorScore: 1,
    });

    const ranked = rankContext(
      [unselected, selected, duplicate],
      ["dataset-1"],
      12,
      Date.parse("2026-09-11T00:00:00.000Z"),
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].datasetId).toBe("dataset-1");
    expect(ranked[0].content).toHaveLength(12);
  });

  it("accepts only finite, nonzero embedding vectors of the configured size", () => {
    expect(vectorLiteral(Array.from({ length: 768 }, () => 0.25))).toMatch(
      /^\[0\.25/,
    );
    expect(() => vectorLiteral(Array.from({ length: 767 }, () => 1))).toThrow(
      AiError,
    );
    expect(() => vectorLiteral(Array.from({ length: 768 }, () => 0))).toThrow(
      /Invalid embedding vector/,
    );
  });
});

describe("AI provider boundaries", () => {
  it("allows only a clean loopback Ollama origin", () => {
    expect(localOllamaUrl("http://localhost:11434/")).toBe(
      "http://localhost:11434",
    );
    for (const url of [
      "https://models.example.com",
      "http://user:pass@localhost:11434",
      "http://localhost:11434/api/chat",
      "http://localhost:11434/?model=x",
    ]) {
      expect(() => localOllamaUrl(url)).toThrow(/loopback address/);
    }
  });

  it("rejects invalid and oversized provider responses", async () => {
    await expect(
      boundedResponseJson(new Response("not json")),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      boundedResponseJson(new Response('{"long":"value"}'), 4),
    ).rejects.toMatchObject({ code: "RESPONSE_LIMIT" });
  });

  it("performs at most one structured-output repair", async () => {
    const generate = vi
      .fn<AiProvider["generate"]>()
      .mockResolvedValueOnce({ text: '{"count":"bad"}', usage: {} })
      .mockResolvedValueOnce({ text: '{"count":3}', usage: {} });
    const provider: AiProvider = {
      name: "ollama",
      model: "test-model",
      generate,
    };

    await expect(
      structuredOutput({
        provider,
        schema: z.object({ count: z.number().int().positive() }),
        messages: [{ role: "user", content: "Count rows" }],
      }),
    ).resolves.toMatchObject({ value: { count: 3 }, repairs: 1 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].messages.at(-1)?.content).toContain(
      "validationErrors",
    );
  });
});
