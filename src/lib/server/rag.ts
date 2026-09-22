import { createHash, randomUUID } from "node:crypto";
import type { Dataset } from "@/lib/domain/schema";
import {
  AiError,
  embedTexts,
  embeddingModel,
  embeddingDimensions,
} from "./ai";
import { withTenant } from "./db";
import type { SessionContext } from "./auth";
import { getDataset } from "./repository";

export const CONTEXT_BUDGET_CHARS = 18_000;
const MAX_CHUNK_CHARS = 2_400;
export type KnowledgeChunk = {
  id: string;
  documentId: string;
  datasetId: string;
  sourceType: string;
  title: string;
  content: string;
  checksum: string;
  vectorScore: number;
  lexicalScore: number;
  updatedAt: string;
  score: number;
};
export type RetrievalResult = {
  method: "hybrid_vector" | "direct_metadata" | "demo_metadata";
  fallback: boolean;
  fallbackReason?: string;
  embeddingModel: string | null;
  durationMs: number;
  contextChars: number;
  chunks: KnowledgeChunk[];
};
export function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
export function normalizeRequest(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, 8_000);
}

/** No raw rows or example values are embedded. Schema changes invalidate this stable document. */
export function datasetKnowledge(
  dataset: Dataset,
): { title: string; content: string; kind: string }[] {
  const schema = {
    datasetId: dataset.id,
    name: dataset.name,
    sourceType: dataset.sourceType,
    fields: dataset.fields.map((field) => ({
      name: field.name,
      type: field.type,
      semantic: field.semantic,
      unit: field.unit,
      nullable: field.nullable,
      allowedAggregations: field.allowedAggregations,
    })),
  };
  const docs = [
    {
      title: "Dataset schema",
      kind: "schema",
      content: JSON.stringify(schema, null, 2),
    },
  ];
  if (
    dataset.fields.some((f) => f.name === "revenue" && f.type === "number") &&
    dataset.fields.some((f) => f.name === "cost" && f.type === "number")
  ) {
    docs.push({
      title: "Profit definition",
      kind: "metric",
      content:
        "Profit is the row-level difference revenue minus cost, aggregated with sum. Both revenue and cost must be present, numeric and non-null. No profit margin, paid status or comparison period is implied by this definition.",
    });
  }
  return docs;
}

export function chunkDocument(
  content: string,
  maxChars = MAX_CHUNK_CHARS,
): string[] {
  if (maxChars < 128 || maxChars > 12_000)
    throw new Error("Invalid chunk limit");
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const pieces: string[] = [];
  let current = "";
  for (const line of normalized.split("\n")) {
    if (current && current.length + line.length + 1 > maxChars) {
      pieces.push(current);
      current = "";
    }
    let remainder = line;
    while (remainder.length > maxChars) {
      pieces.push(remainder.slice(0, maxChars));
      remainder = remainder.slice(maxChars);
    }
    if (remainder) current += (current ? "\n" : "") + remainder;
  }
  if (current) pieces.push(current);
  return pieces;
}

export function rankContext(
  chunks: KnowledgeChunk[],
  selectedDatasetIds: string[],
  budget = CONTEXT_BUDGET_CHARS,
  now = Date.now(),
): KnowledgeChunk[] {
  const selected = new Set(selectedDatasetIds);
  const ranked = chunks
    .filter((chunk) => selected.has(chunk.datasetId))
    .map((chunk) => {
      const age =
        Math.max(0, now - new Date(chunk.updatedAt).getTime()) / 86_400_000;
      const recency = Number.isFinite(age) ? 1 / (1 + age / 30) : 0;
      const quality = ["metric", "definition", "schema"].includes(
        chunk.sourceType,
      )
        ? 1
        : 0.5;
      return {
        ...chunk,
        score:
          Math.max(0, Math.min(1, chunk.vectorScore)) * 0.65 +
          Math.max(0, Math.min(1, chunk.lexicalScore)) * 0.2 +
          0.08 +
          recency * 0.03 +
          quality * 0.04,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const result: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const chunk of ranked) {
    if (seen.has(chunk.checksum) || result.length >= 12 || used >= budget)
      continue;
    const content = chunk.content.slice(0, Math.max(0, budget - used));
    if (!content) continue;
    result.push({ ...chunk, content });
    used += content.length;
    seen.add(chunk.checksum);
  }
  return result;
}

export function metadataRetrieval(
  datasets: Dataset[],
  reason: string,
  demo = false,
): RetrievalResult {
  const chunks = datasets.flatMap((dataset) =>
    datasetKnowledge(dataset).flatMap((doc) =>
      chunkDocument(doc.content).map((content, index) => ({
        id: `metadata-${dataset.id}-${doc.kind}-${index}`,
        documentId: "direct-metadata",
        datasetId: dataset.id,
        sourceType: doc.kind,
        title: doc.title,
        content,
        checksum: checksum(content),
        vectorScore: 0,
        lexicalScore: 0,
        updatedAt: dataset.updatedAt,
        score: 0,
      })),
    ),
  );
  const selected = rankContext(
    chunks,
    datasets.map((d) => d.id),
  );
  return {
    method: demo ? "demo_metadata" : "direct_metadata",
    fallback: true,
    fallbackReason: reason,
    embeddingModel: null,
    durationMs: 0,
    contextChars: selected.reduce((n, c) => n + c.content.length, 0),
    chunks: selected,
  };
}

export function vectorLiteral(vector: number[]): string {
  if (
    vector.length !== embeddingDimensions() ||
    vector.some((n) => !Number.isFinite(n)) ||
    vector.every((n) => n === 0)
  )
    throw new AiError("Invalid embedding vector.", "EMBEDDING_DIMENSIONS", 422);
  return `[${vector.join(",")}]`;
}

/** Authorization is enforced by SQL predicates and RLS BEFORE returning chunk contents. */
export async function retrieveContext(
  ctx: SessionContext,
  datasets: Dataset[],
  prompt: string,
  signal?: AbortSignal,
): Promise<RetrievalResult> {
  const started = Date.now();
  const ids = datasets.map((d) => d.id);
  if (
    !ids.length ||
    ids.length > 10 ||
    datasets.some((d) => d.workspaceId !== ctx.workspace.id)
  )
    throw new AiError("The selected data is unavailable.", "NOT_FOUND", 404);
  const available = await withTenant(
    ctx.user.id,
    ctx.workspace.id,
    async (sql) => sql`
    select count(*)::int as count from knowledge_chunks c
    join knowledge_documents d on d.id = c.document_id and d.workspace_id = c.workspace_id
    join datasets ds on ds.id = c.dataset_id and ds.workspace_id = c.workspace_id
    join data_sources s on s.id = ds.source_id and s.workspace_id = ds.workspace_id
    where c.workspace_id = ${ctx.workspace.id} and c.dataset_id = any(${ids}::uuid[])
      and d.status = 'ready' and c.embedding_model = ${embeddingModel()} and c.embedding is not null
      and s.status <> 'disconnected'
  `,
  );
  if (!Number(available[0]?.count))
    return {
      ...metadataRetrieval(
        datasets,
        "Selected metadata is not indexed yet; using freshly authorized schema. This is not vector retrieval.",
      ),
      durationMs: Date.now() - started,
    };
  signal?.throwIfAborted();
  // A ready index with an unavailable embedding service fails explicitly. It never silently becomes fake RAG.
  const [vector] = await embedTexts(
    [`search_query: ${normalizeRequest(prompt)}`],
    signal,
    "query",
  );
  const literal = vectorLiteral(vector);
  const candidates = await withTenant(
    ctx.user.id,
    ctx.workspace.id,
    async (sql) => sql`
    with authorized as materialized (
      select c.id,c.document_id,c.dataset_id,c.content,c.checksum,c.embedding,d.kind,d.title,d.updated_at,
        (1 - (c.embedding OPERATOR(extensions.<=>) ${literal}::extensions.vector)) as vector_score,
        ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', ${normalizeRequest(prompt)})) as lexical_score
      from knowledge_chunks c
      join knowledge_documents d on d.id = c.document_id and d.workspace_id = c.workspace_id
      join datasets ds on ds.id = c.dataset_id and ds.workspace_id = c.workspace_id
      join data_sources s on s.id = ds.source_id and s.workspace_id = ds.workspace_id
      where c.workspace_id = ${ctx.workspace.id} and c.dataset_id = any(${ids}::uuid[])
        and d.status = 'ready' and c.embedding_model = ${embeddingModel()} and c.embedding is not null
        and s.status <> 'disconnected'
    ), candidate_ids as (
      (select id from authorized order by vector_score desc limit 32)
      union
      (select id from authorized where lexical_score > 0 order by lexical_score desc limit 16)
    )
    select a.id,a.document_id,a.dataset_id,a.content,a.checksum,a.kind,a.title,a.updated_at,a.vector_score,a.lexical_score
    from authorized a join candidate_ids c on c.id = a.id
  `,
  );
  const chunks = rankContext(
    candidates.map((c) => ({
      id: String(c.id),
      documentId: String(c.document_id),
      datasetId: String(c.dataset_id),
      sourceType: String(c.kind),
      title: String(c.title),
      content: String(c.content),
      checksum: String(c.checksum),
      vectorScore: Number(c.vector_score),
      lexicalScore: Number(c.lexical_score),
      updatedAt: new Date(String(c.updated_at)).toISOString(),
      score: 0,
    })),
    ids,
  );
  if (!chunks.length)
    return {
      ...metadataRetrieval(
        datasets,
        "The selected index became unavailable; using freshly authorized schema.",
      ),
      durationMs: Date.now() - started,
    };
  return {
    method: "hybrid_vector",
    fallback: false,
    embeddingModel: embeddingModel(),
    durationMs: Date.now() - started,
    contextChars: chunks.reduce((n, c) => n + c.content.length, 0),
    chunks,
  };
}

export async function indexDataset(
  ctx: SessionContext,
  datasetId: string,
  signal?: AbortSignal,
): Promise<{
  documents: number;
  embeddedChunks: number;
  cachedChunks: number;
}> {
  const dataset = await getDataset(ctx, datasetId);
  const docs = datasetKnowledge(dataset);
  const model = embeddingModel();
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`update datasets set indexing_status = 'processing' where id = ${datasetId} and workspace_id = ${ctx.workspace.id}`;
    for (const doc of docs) {
      await sql`insert into knowledge_documents (id,workspace_id,dataset_id,source_id,kind,title,content,checksum,status)
        values (${randomUUID()},${ctx.workspace.id},${datasetId},${dataset.sourceId},${doc.kind},${doc.title},${doc.content},${checksum(doc.content)},'stale')
        on conflict (workspace_id,dataset_id,kind,title) do update set content = excluded.content, checksum = excluded.checksum,
          status = case when knowledge_documents.checksum = excluded.checksum then knowledge_documents.status else 'stale' end,
          updated_at = case when knowledge_documents.checksum = excluded.checksum then knowledge_documents.updated_at else now() end`;
    }
    // Derived definitions disappear when their required fields are removed.
    if (!docs.some((d) => d.kind === "metric"))
      await sql`delete from knowledge_documents where workspace_id = ${ctx.workspace.id} and dataset_id = ${datasetId} and kind = 'metric' and title = 'Profit definition'`;
  });
  const persisted = await withTenant(
    ctx.user.id,
    ctx.workspace.id,
    async (sql) => sql`
    select id,content,checksum from knowledge_documents where workspace_id = ${ctx.workspace.id} and dataset_id = ${datasetId} and status <> 'disconnected' order by id limit 100`,
  );
  let embeddedChunks = 0;
  let cachedChunks = 0;
  for (const doc of persisted) {
    signal?.throwIfAborted();
    const contents = chunkDocument(String(doc.content)).slice(0, 64);
    if (chunkDocument(String(doc.content)).length > 64)
      throw new AiError(
        "A knowledge document exceeds its indexing limit.",
        "DOCUMENT_LIMIT",
        422,
      );
    const hashes = contents.map(checksum);
    const cached = await withTenant(
      ctx.user.id,
      ctx.workspace.id,
      async (sql) => sql`
      select checksum from knowledge_chunks where workspace_id = ${ctx.workspace.id} and document_id = ${doc.id} and embedding_model = ${model} and embedding is not null and checksum = any(${hashes}::text[])`,
    );
    const existing = new Set(cached.map((c) => String(c.checksum)));
    const pending = contents
      .map((content, index) => ({ content, checksum: hashes[index] }))
      .filter((c) => !existing.has(c.checksum));
    const vectors: number[][] = [];
    for (let offset = 0; offset < pending.length; offset += 16)
      vectors.push(
        ...(await embedTexts(
          pending
            .slice(offset, offset + 16)
            .map((c) => `search_document: ${c.content}`),
          signal,
          "passage",
        )),
      );
    await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
      const current =
        await sql`select checksum from knowledge_documents where id = ${doc.id} and workspace_id = ${ctx.workspace.id} for update`;
      if (!current.length || current[0].checksum !== doc.checksum)
        throw new AiError(
          "Metadata changed during indexing; the job will retry.",
          "INDEX_STALE",
          409,
        );
      for (let index = 0; index < pending.length; index++) {
        const chunk = pending[index];
        await sql`insert into knowledge_chunks (id,workspace_id,document_id,dataset_id,content,embedding,embedding_model,checksum)
          values (${randomUUID()},${ctx.workspace.id},${doc.id},${datasetId},${chunk.content},${vectorLiteral(vectors[index])}::extensions.vector,${model},${chunk.checksum})
          on conflict (document_id,checksum,embedding_model) do update set content = excluded.content, embedding = excluded.embedding`;
      }
      await sql`delete from knowledge_chunks where workspace_id = ${ctx.workspace.id} and document_id = ${doc.id} and (embedding_model <> ${model} or not(checksum = any(${hashes}::text[])))`;
      await sql`update knowledge_documents set status = 'ready' where id = ${doc.id} and workspace_id = ${ctx.workspace.id}`;
    });
    embeddedChunks += pending.length;
    cachedChunks += contents.length - pending.length;
  }
  const latest = await getDataset(ctx, datasetId);
  if (
    checksum(JSON.stringify(datasetKnowledge(latest))) !==
    checksum(JSON.stringify(docs))
  )
    throw new AiError(
      "Dataset schema changed during indexing; the job will retry.",
      "INDEX_STALE",
      409,
    );
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`update datasets set indexing_status = 'ready' where id = ${datasetId} and workspace_id = ${ctx.workspace.id}`;
  });
  return { documents: persisted.length, embeddedChunks, cachedChunks };
}
