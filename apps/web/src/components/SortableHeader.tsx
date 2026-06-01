// Two-row table header pattern: clickable sort header (top row) + per-column
// filter cells (bottom row, rendered by the caller). Mirrors the Jobs page so
// every list table looks/behaves the same.
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';
export type SortState<K extends string> = { key: K; dir: SortDir };

export function SortableHeader<K extends string>({
  label, sortKey, sort, onSort, align,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  return (
    <th className="th cursor-pointer select-none hover:text-ink" onClick={() => onSort(sortKey)}>
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        {label}
        {active
          ? sort.dir === 'asc'
            ? <ArrowUp size={12} className="text-copper" />
            : <ArrowDown size={12} className="text-copper" />
          : <ArrowUpDown size={12} className="text-line" />}
      </span>
    </th>
  );
}

/** Toggle direction when clicking the same key; otherwise switch + reset to asc. */
export function nextSort<K extends string>(prev: SortState<K>, key: K): SortState<K> {
  return prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

/** Generic comparator: numeric-aware string compare. */
export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  if (a === b) return 0;
  const mult = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mult;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * mult;
}
