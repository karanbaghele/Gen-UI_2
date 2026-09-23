import { randomUUID } from "node:crypto";
import type { SessionContext } from "./auth";
import { AiError } from "./ai";
import { withTenant } from "./db";
import { getDataset } from "./repository";
import { checksum, datasetKnowledge, indexDataset } from "./rag";
import { refreshConnectedDataset } from "./connectors";
import { HttpError } from "./security";

export type IndexJobResult = {
  id: string;
  status: "ready" | "queued" | "failed";
  embeddedChunks?: number;
  cachedChunks?: number;
  error?: string;
};
export const retryDelaySeconds = (attempt: number): number =>
  Math.min(900, 15 * 2 ** Math.max(0, attempt - 1));

export async function enqueueIndex(
  ctx: SessionContext,
  datasetId: string,
): Promise<string> {
  const dataset = await getDataset(ctx, datasetId);
  const fingerprint = checksum(JSON.stringify(datasetKnowledge(dataset)));
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const rows =
      await sql`insert into jobs (id,workspace_id,source_id,dataset_id,type,payload,idempotency_key)
      values (${randomUUID()},${ctx.workspace.id},${dataset.sourceId},${datasetId},'index_dataset',${sql.json({ datasetId })},${`index:${datasetId}:${fingerprint}`})
      on conflict (workspace_id,idempotency_key) do update set
        status = case when jobs.status = 'processing' then jobs.status else 'queued' end,
        attempts = case when jobs.status = 'processing' then jobs.attempts else 0 end,
        run_after = now(), last_error = null, updated_at = now()
      returning id`;
    await sql`update datasets set indexing_status = case when indexing_status = 'processing' then indexing_status else 'queued' end where id = ${datasetId} and workspace_id = ${ctx.workspace.id}`;
    return String(rows[0].id);
  });
}

/** Durable claims use SKIP LOCKED, expiring leases and capped retries. Work is always tenant-scoped. */
export async function runIndexJobs(
  ctx: SessionContext,
  limit = 1,
  signal?: AbortSignal,
): Promise<IndexJobResult[]> {
  const results: IndexJobResult[] = [];
  for (
    let iteration = 0;
    iteration < Math.min(Math.max(limit, 1), 5);
    iteration++
  ) {
    if (signal?.aborted) break;
    const owner = randomUUID();
    const jobs = await withTenant(
      ctx.user.id,
      ctx.workspace.id,
      async (sql) => {
        // A worker that died on its last allowed attempt must not leave processing jobs forever.
        await sql`update jobs set status = 'failed', last_error = 'Worker lease expired after the final attempt.', lease_owner = null, lease_until = null, updated_at = now()
        where workspace_id = ${ctx.workspace.id} and type = 'index_dataset' and status = 'processing' and lease_until < now() and attempts >= max_attempts`;
        return sql`with candidate as (
        select j.id from jobs j join data_sources s on s.id = j.source_id and s.workspace_id = j.workspace_id
        where j.workspace_id = ${ctx.workspace.id} and j.type = 'index_dataset' and j.attempts < j.max_attempts and s.status <> 'disconnected'
          and ((j.status in ('queued','stale') and j.run_after <= now()) or (j.status = 'processing' and j.lease_until < now()))
        order by j.run_after,j.created_at for update of j skip locked limit 1
      ) update jobs j set status = 'processing', attempts = j.attempts + 1, lease_owner = ${owner}, lease_until = now() + interval '90 seconds', updated_at = now()
        from candidate c where j.id = c.id returning j.id,j.dataset_id,j.attempts,j.max_attempts`;
      },
    );
    const job = jobs[0];
    if (!job) break;
    const controller = new AbortController();
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(600_000),
      ...(signal ? [signal] : []),
    ]);
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void withTenant(
        ctx.user.id,
        ctx.workspace.id,
        async (sql) => sql`
        update jobs j set lease_until = now() + interval '90 seconds', updated_at = now()
        where j.id = ${job.id} and j.workspace_id = ${ctx.workspace.id} and j.lease_owner = ${owner} and j.status = 'processing'
          and exists(select 1 from data_sources s where s.id = j.source_id and s.workspace_id = j.workspace_id and s.status <> 'disconnected') returning j.id
      `,
      )
        .then((rows) => {
          if (!rows.length) controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          renewing = false;
        });
    }, 25_000);
    timer.unref?.();
    try {
      const indexed = await indexDataset(ctx, String(job.dataset_id), combined);
      combined.throwIfAborted();
      await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
        await sql`update jobs set status = 'ready', lease_owner = null, lease_until = null, last_error = null, updated_at = now()
          where id = ${job.id} and workspace_id = ${ctx.workspace.id} and lease_owner = ${owner}`;
      });
      results.push({
        id: String(job.id),
        status: "ready",
        embeddedChunks: indexed.embeddedChunks,
        cachedChunks: indexed.cachedChunks,
      });
    } catch (error) {
      const exhausted = Number(job.attempts) >= Number(job.max_attempts);
      const safeError =
        error instanceof AiError
          ? error.message
          : combined.aborted
            ? "Indexing interrupted; the durable job can be retried."
            : "Indexing failed. Check the local database and configured embedding service.";
      const status = exhausted ? "failed" : "queued";
      await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
        const owned =
          await sql`update jobs set status = ${status}, lease_owner = null, lease_until = null, last_error = ${safeError},
          run_after = now() + make_interval(secs => ${retryDelaySeconds(Number(job.attempts))}), updated_at = now()
          where id = ${job.id} and workspace_id = ${ctx.workspace.id} and lease_owner = ${owner} returning dataset_id`;
        if (owned.length)
          await sql`update datasets set indexing_status = ${exhausted ? "failed" : "queued"} where id = ${job.dataset_id} and workspace_id = ${ctx.workspace.id}`;
      });
      results.push({ id: String(job.id), status, error: safeError });
    } finally {
      clearInterval(timer);
    }
  }
  return results;
}

export async function listIndexJobs(ctx: SessionContext) {
  return withTenant(
    ctx.user.id,
    ctx.workspace.id,
    async (sql) => sql`
    select id,dataset_id as "datasetId",status,attempts,max_attempts as "maxAttempts",run_after as "runAfter",last_error as error,updated_at as "updatedAt"
    from jobs where workspace_id = ${ctx.workspace.id} and type = 'index_dataset' order by updated_at desc limit 50`,
  );
}

export async function runRefreshJobs(
  ctx: SessionContext,
  limit = 1,
  signal?: AbortSignal,
): Promise<IndexJobResult[]> {
  const results: IndexJobResult[] = [];
  for (
    let iteration = 0;
    iteration < Math.min(Math.max(limit, 1), 5);
    iteration++
  ) {
    if (signal?.aborted) break;
    const owner = randomUUID();
    const jobs = await withTenant(
      ctx.user.id,
      ctx.workspace.id,
      async (sql) => {
        await sql`update jobs set status='failed',last_error='Worker lease expired after the final attempt.',lease_owner=null,lease_until=null,updated_at=now()
          where workspace_id=${ctx.workspace.id} and type='refresh_source' and status='processing' and lease_until<now() and attempts>=max_attempts`;
        return sql`with candidate as (
          select j.id from jobs j join data_sources s on s.id=j.source_id and s.workspace_id=j.workspace_id
          where j.workspace_id=${ctx.workspace.id} and j.type='refresh_source' and j.attempts<j.max_attempts and s.status<>'disconnected'
            and ((j.status in ('queued','stale') and j.run_after<=now()) or (j.status='processing' and j.lease_until<now()))
          order by j.run_after,j.created_at for update of j skip locked limit 1
        ) update jobs j set status='processing',attempts=j.attempts+1,lease_owner=${owner},lease_until=now()+interval '90 seconds',updated_at=now()
          from candidate c where j.id=c.id returning j.id,j.dataset_id,j.source_id,j.attempts,j.max_attempts`;
      },
    );
    const job = jobs[0];
    if (!job) break;
    try {
      const dataset = await refreshConnectedDataset(
        ctx,
        String(job.dataset_id),
      );
      signal?.throwIfAborted();
      await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
        await sql`update jobs j set status='queued',attempts=0,lease_owner=null,lease_until=null,last_error=null,
          run_after=now()+make_interval(secs => (select refresh_interval_seconds from data_sources where id=j.source_id and workspace_id=j.workspace_id)),updated_at=now()
          where j.id=${job.id} and j.workspace_id=${ctx.workspace.id} and j.lease_owner=${owner}`;
      });
      results.push({
        id: String(job.id),
        status: "ready",
        cachedChunks: dataset.rowCount,
      });
    } catch (error) {
      const exhausted = Number(job.attempts) >= Number(job.max_attempts);
      const safeError =
        error instanceof HttpError
          ? error.message
          : signal?.aborted
            ? "Refresh interrupted; the durable job can be retried."
            : "Source refresh failed. Check its credentials and availability.";
      const status = exhausted ? "failed" : "queued";
      await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
        await sql`update jobs set status=${status},lease_owner=null,lease_until=null,last_error=${safeError},
          run_after=now()+make_interval(secs => ${retryDelaySeconds(Number(job.attempts))}),updated_at=now()
          where id=${job.id} and workspace_id=${ctx.workspace.id} and lease_owner=${owner}`;
        await sql`update data_sources set status='error',error=${safeError},updated_at=now()
          where id=${job.source_id} and workspace_id=${ctx.workspace.id}`;
      });
      results.push({ id: String(job.id), status, error: safeError });
    }
  }
  return results;
}

export async function runDueJobs(
  ctx: SessionContext,
  limit = 2,
  signal?: AbortSignal,
) {
  const index = await runIndexJobs(ctx, limit, signal);
  const refresh = await runRefreshJobs(ctx, limit, signal);
  return [...index, ...refresh];
}
