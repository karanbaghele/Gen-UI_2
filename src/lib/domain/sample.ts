import { profileRows } from "./profiling";
import type { DataRow, Dataset } from "./schema";

/** Reproducible synthetic sales source. Every row and all aggregates are real local sample data. */
export function createSampleDataset(
  workspaceId: string,
  id = "sample-sales",
  now = new Date().toISOString(),
): Dataset {
  const products = [
    { product: "Arc Desk", category: "Furniture", price: 620, cost: 362 },
    { product: "Studio Chair", category: "Furniture", price: 280, cost: 154 },
    { product: "Halo Lamp", category: "Lighting", price: 95, cost: 44 },
    { product: "Focus Monitor", category: "Technology", price: 390, cost: 273 },
    {
      product: "Everyday Keyboard",
      category: "Technology",
      price: 85,
      cost: 46,
    },
    {
      product: "Canvas Organizer",
      category: "Accessories",
      price: 32,
      cost: 13,
    },
    { product: "Linen Notebook", category: "Accessories", price: 18, cost: 6 },
    { product: "Task Light", category: "Lighting", price: 145, cost: 72 },
  ];
  const markets = [
    { region: "North America", country: "United States" },
    { region: "Europe", country: "Germany" },
    { region: "Asia Pacific", country: "India" },
    { region: "Europe", country: "United Kingdom" },
    { region: "North America", country: "Canada" },
    { region: "Asia Pacific", country: "Australia" },
  ];
  let seed = 872341;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const anchor = new Date(now);
  const start = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 12, 1),
  );
  const end = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 0),
  );
  const rows: DataRow[] = [];
  for (
    let day = new Date(start);
    day <= end;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const monthIndex =
      (day.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      day.getUTCMonth() -
      start.getUTCMonth();
    const orders = 3 + Math.floor(random() * 4) + Math.floor(monthIndex / 4);
    for (let order = 0; order < orders; order++) {
      const product = products[Math.floor(random() * products.length)];
      const market = markets[Math.floor(random() * markets.length)];
      const quantity = 1 + Math.floor(random() * 5);
      const discount = random() > 0.8 ? 0.9 : 1;
      rows.push({
        order_id: `ORD-${String(rows.length + 1).padStart(5, "0")}`,
        order_date: day.toISOString().slice(0, 10),
        ...market,
        product: product.product,
        category: product.category,
        revenue: Math.round(product.price * quantity * discount * 100) / 100,
        cost: product.cost * quantity,
        quantity,
        customer_id: `CUS-${String(1 + Math.floor(random() * 180)).padStart(3, "0")}`,
        payment_status: random() > 0.06 ? "paid" : "pending",
      });
    }
  }
  const dataset = profileRows(rows, {
    id,
    workspaceId,
    sourceId: `source-${id}`,
    name: "Northstar sales",
    sourceType: "sample",
    now,
  });
  for (const field of dataset.fields)
    if (["revenue", "cost"].includes(field.name)) field.unit = "USD";
  dataset.warnings.push(
    "Synthetic sample sales data in USD; generated deterministically for local onboarding.",
  );
  return dataset;
}
