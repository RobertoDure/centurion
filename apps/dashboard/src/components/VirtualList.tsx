import type { ReactNode } from 'react';
import { useState } from 'react';

export interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  height: number;
  overscan?: number;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  emptyMessage?: string;
  ariaLabel?: string;
}

/**
 * Minimal windowed list: only the rows intersecting the viewport (plus overscan)
 * are mounted, so a 500-row live feed stays cheap. Hand-written to avoid a
 * runtime dependency.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  overscan = 6,
  getKey,
  renderRow,
  emptyMessage = 'Waiting for events…',
  ariaLabel,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);

  if (items.length === 0) {
    return (
      <div
        data-testid="virtual-list"
        aria-label={ariaLabel}
        className="flex items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const visible = items.slice(start, end);

  return (
    <div
      data-testid="virtual-list"
      role="list"
      aria-label={ariaLabel}
      className="overflow-y-auto rounded-lg border border-slate-200 bg-white"
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {visible.map((item, offset) => {
          const index = start + offset;
          return (
            <div
              key={getKey(item, index)}
              role="listitem"
              className="absolute left-0 right-0 flex items-center gap-3 border-b border-slate-100 px-3"
              style={{ top: index * rowHeight, height: rowHeight }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
