import { layoutItemSchema, type LayoutItem, type Widget } from "./schema";
import { componentRegistry } from "./registry";
import { DomainError } from "./profiling";

export function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

export function validateLayout(layout: LayoutItem[], widgets: Widget[]): void {
  const ids = new Set<string>();
  for (const raw of layout) {
    const item = layoutItemSchema.parse(raw);
    if (ids.has(item.i))
      throw new DomainError("Each widget must have exactly one layout item.");
    ids.add(item.i);
    const widget = widgets.find((widget) => widget.id === item.i);
    if (!widget) throw new DomainError("Layout references an unknown widget.");
    const minimum = componentRegistry[widget.type].minSize;
    if (item.x + item.w > 12 || item.w < minimum.w || item.h < minimum.h)
      throw new DomainError(
        "Widget layout exceeds the grid or is smaller than its supported minimum.",
      );
  }
  if (
    widgets.length !== ids.size ||
    widgets.some((widget) => !ids.has(widget.id))
  )
    throw new DomainError("Every widget requires a layout item.");
  for (let i = 0; i < layout.length; i++)
    for (let j = i + 1; j < layout.length; j++)
      if (overlaps(layout[i], layout[j]))
        throw new DomainError("Widget layouts must not overlap.");
}

/** First available row-major space; existing positions never change. */
export function autoPlace(
  existing: LayoutItem[],
  widget: Pick<Widget, "id" | "type">,
  options: { belowWidgetId?: string; w?: number; h?: number } = {},
): LayoutItem {
  if (existing.some((item) => item.i === widget.id))
    throw new DomainError("Widget already has a layout item.");
  const definition = componentRegistry[widget.type];
  const w = options.w ?? definition.defaultSize.w,
    h = options.h ?? definition.defaultSize.h;
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < definition.minSize.w ||
    w > 12 ||
    h < definition.minSize.h ||
    h > 50
  )
    throw new DomainError("Unsupported widget size.");
  const anchor = options.belowWidgetId
    ? existing.find((item) => item.i === options.belowWidgetId)
    : undefined;
  if (options.belowWidgetId && !anchor)
    throw new DomainError("The requested placement anchor is unavailable.");
  const firstY = anchor ? anchor.y + anchor.h : 0;
  for (let y = firstY; y <= 10_000; y++) {
    const positions =
      anchor && anchor.x + w <= 12
        ? [
            anchor.x,
            ...Array.from({ length: 13 - w }, (_, x) => x).filter(
              (x) => x !== anchor.x,
            ),
          ]
        : Array.from({ length: 13 - w }, (_, x) => x);
    for (const x of positions) {
      const candidate: LayoutItem = { i: widget.id, x, y, w, h };
      if (!existing.some((item) => overlaps(item, candidate))) return candidate;
    }
  }
  throw new DomainError("No space is available within the supported layout.");
}

export function stackLayout(layout: LayoutItem[]): LayoutItem[] {
  let y = 0;
  return [...layout]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => {
      const next = { ...item, x: 0, y, w: 12 };
      y += item.h;
      return next;
    });
}
