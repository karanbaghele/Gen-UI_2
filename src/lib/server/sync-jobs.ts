import "server-only";
import type { SessionContext } from "./auth";
import { withTenant } from "./db";

export async function scheduleSourceRefresh(
  ctx: SessionContext,
  datasetId: string,
  sourceId: string,
) {
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`insert into jobs(workspace_id,dataset_id,source_id,type,payload,idempotency_key,run_after)
      values(${ctx.workspace.id},${datasetId},${sourceId},'refresh_source',${sql.json({ datasetId })},${`refresh:${sourceId}`},
        now()+make_interval(secs => coalesce((select refresh_interval_seconds from data_sources where id=${sourceId} and workspace_id=${ctx.workspace.id}),60)))
      on conflict(workspace_id,idempotency_key) do update set dataset_id=excluded.dataset_id,status='queued',attempts=0,last_error=null,run_after=excluded.run_after,updated_at=now()`;
  });
}
