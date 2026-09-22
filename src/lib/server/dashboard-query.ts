import "server-only";
import type { DataValue, QueryResult } from "@/lib/domain/schema";
import { dashboardFilterToQueryFilter, executeQuery } from "@/lib/domain/query";
import type { SessionContext } from "./auth";
import { getDashboard, getDataset } from "./repository";
import { HttpError } from "./security";
export async function queryDashboard(
  ctx: SessionContext,
  id: string,
  filters: Record<string, DataValue | DataValue[]> = {},
) {
  const dashboard = await getDashboard(ctx, id);
  if (dashboard.disconnected)
    throw new HttpError(
      409,
      "A dataset used by this dashboard is disconnected or deleted. Reconnect it to refresh results.",
      "source_disconnected",
    );
  const datasets = await Promise.all(
    dashboard.spec.datasetIds.map((datasetId) => getDataset(ctx, datasetId)),
  );
  if (datasets.some((dataset) => dataset.sourceStatus === "disconnected"))
    throw new HttpError(
      409,
      "A connected source is disconnected. Reconnect it to refresh results.",
      "source_disconnected",
    );
  const results: Record<string, QueryResult> = {};
  for (const filterId of Object.keys(filters))
    if (!dashboard.spec.filters.some((filter) => filter.id === filterId))
      throw new HttpError(400, "A filter is not part of this dashboard.");
  for (const query of dashboard.spec.queries) {
    const extra = dashboard.spec.filters
      .filter((filter) => filter.queryIds.includes(query.id))
      .flatMap((filter) => {
        const value = filters[filter.id] ?? filter.defaultValue;
        if (value === undefined) return [];
        const condition = dashboardFilterToQueryFilter(filter, value);
        return condition ? [condition] : [];
      });
    results[query.id] = executeQuery(query, datasets, ctx.workspace.id, extra);
  }
  return { dashboard, datasets, results };
}
