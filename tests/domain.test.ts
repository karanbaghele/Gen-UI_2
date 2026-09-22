import { describe, expect, it } from "vitest";
import {
  applyDashboardPatch,
  autoPlace,
  createDemoDashboard,
  createSampleDataset,
  executeQuery,
  exportRowsCsv,
  overlaps,
  profileCsv,
  validateDashboard,
} from "@/lib/domain";
import { assertLocalTestAuth, localUrl } from "@/lib/server/security";

describe("CSV profiling and deterministic queries", () => {
  it("preserves zero, null, and missing cells as distinct values", () => {
    const dataset = profileCsv(
      "date,revenue,note\n2026-01-01,0,\n2026-01-02,,null\n2026-01-03,20",
      {
        id: "data-1",
        workspaceId: "work-1",
        sourceId: "source-1",
        name: "Example",
      },
    );
    const revenue = dataset.fields.find((field) => field.name === "revenue")!;
    expect(dataset.rows[0].revenue).toBe(0);
    expect(dataset.rows[1].revenue).toBeNull();
    expect(Object.hasOwn(dataset.rows[2], "note")).toBe(false);
    expect(revenue.stats.nullCount).toBe(1);
  });

  it("executes only approved, workspace-scoped aggregates", () => {
    const dataset = createSampleDataset("work-1", "data-1");
    const result = executeQuery(
      {
        id: "query-1",
        datasetId: "data-1",
        metrics: [
          { id: "sales", op: "sum", field: "revenue" },
          { id: "profit", op: "sum", derived: "profit" },
        ],
        groupBy: [{ field: "region" }],
        filters: [],
        orderBy: [{ field: "sales", direction: "desc" }],
        limit: 10,
      },
      [dataset],
      "work-1",
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].sales).toEqual(expect.any(Number));
    expect(() =>
      executeQuery(
        {
          id: "query-2",
          datasetId: "data-1",
          metrics: [{ id: "bad", op: "sum", field: "payment_status" }],
          groupBy: [],
          filters: [],
          orderBy: [],
          limit: 10,
        },
        [dataset],
        "work-1",
      ),
    ).toThrow(/Aggregation/);
    expect(() =>
      executeQuery(
        {
          id: "query-3",
          datasetId: "data-1",
          metrics: [{ id: "sales", op: "sum", field: "revenue" }],
          groupBy: [],
          filters: [],
          orderBy: [],
          limit: 10,
        },
        [dataset],
        "another-workspace",
      ),
    ).toThrow(/unavailable/);
  });
});

describe("dashboard schema safety", () => {
  it("rejects executable markup and protects the original dashboard when a patch fails", () => {
    const dataset = createSampleDataset("work-1", "data-1");
    const dashboard = createDemoDashboard(dataset);
    expect(validateDashboard(dashboard, [dataset], "work-1")).toEqual(
      dashboard,
    );
    expect(() =>
      applyDashboardPatch(
        dashboard,
        [{ op: "updateMetadata", description: "<script>alert(1)</script>" }],
        [dataset],
        "work-1",
      ),
    ).toThrow();
    expect(dashboard.description).not.toContain("script");
    expect(() =>
      applyDashboardPatch(
        dashboard,
        [{ op: "moveWidget", widgetId: "missing", x: 0, y: 0 }],
        [dataset],
        "work-1",
      ),
    ).toThrow(/unavailable/);
  });

  it("places a new widget without moving or overlapping existing cards", () => {
    const existing = [
      { i: "one", x: 0, y: 0, w: 6, h: 3 },
      { i: "two", x: 6, y: 0, w: 6, h: 3 },
    ];
    const placed = autoPlace(existing, { id: "three", type: "table" });
    expect(existing).toEqual([
      { i: "one", x: 0, y: 0, w: 6, h: 3 },
      { i: "two", x: 6, y: 0, w: 6, h: 3 },
    ]);
    expect(existing.some((item) => overlaps(item, placed))).toBe(false);
  });
});

describe("local security boundaries", () => {
  it("rejects remote infrastructure URLs and production test-auth bypasses", () => {
    expect(() => localUrl("https://database.example.com", "Database")).toThrow(
      /local service/,
    );
    expect(
      assertLocalTestAuth("http://127.0.0.1:3000", "a".repeat(32), {
        NODE_ENV: "production",
        GENUI_TEST_AUTH: "true",
        GENUI_TEST_AUTH_TOKEN: "a".repeat(32),
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("neutralizes spreadsheet formulas in CSV exports", () => {
    const csv = exportRowsCsv(
      [
        {
          customer: "=HYPERLINK(\"https://example.invalid\")",
          note: "  +SUM(1,1)",
          safe: "ordinary text",
        },
      ],
      ["customer", "note", "safe"],
    );

    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'  +SUM");
    expect(csv).toContain('"ordinary text"');
  });
});
