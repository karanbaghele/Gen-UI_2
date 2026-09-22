import nextEnv from "@next/env";
import type { SessionContext } from "../src/lib/server/auth";
import { getDb } from "../src/lib/server/db";
import { runDueJobs } from "../src/lib/server/jobs";

nextEnv.loadEnvConfig(process.cwd());

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function contexts(): Promise<SessionContext[]> {
  const rows = await getDb()`
    select distinct on (j.workspace_id)
      p.id as user_id,p.email,p.name,p.avatar_url,
      w.id as workspace_id,w.name as workspace_name,m.role
    from jobs j
    join workspaces w on w.id=j.workspace_id
    join lateral (
      select membership.user_id,membership.role
      from memberships membership
      where membership.workspace_id=j.workspace_id
        and membership.role in ('admin','analyst')
      order by case membership.role when 'admin' then 0 else 1 end,membership.created_at
      limit 1
    ) m on true
    join profiles p on p.id=m.user_id
    where j.status in ('queued','stale','processing')
      and (j.run_after<=now() or j.lease_until<now())
    order by j.workspace_id
  `;
  return rows.map((row) => ({
    user: {
      id: String(row.user_id),
      email: String(row.email),
      name: String(row.name),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    },
    workspace: {
      id: String(row.workspace_id),
      name: String(row.workspace_name),
      role: row.role as SessionContext["workspace"]["role"],
    },
  }));
}

async function main() {
  console.log("GenUI local worker started.");
  while (!stopping) {
    for (const context of await contexts()) {
      if (stopping) break;
      const results = await runDueJobs(context, 3);
      for (const result of results)
        console.log(
          JSON.stringify({
            event: "job.completed",
            id: result.id,
            status: result.status,
          }),
        );
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  await getDb().end({ timeout: 5 });
  console.log("GenUI local worker stopped.");
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "worker.failed",
      message: error instanceof Error ? error.message : "Unknown worker error",
    }),
  );
  process.exitCode = 1;
});
