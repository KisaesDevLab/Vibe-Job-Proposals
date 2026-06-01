// Searchable single-select that drops into anywhere a native <select className="input">
// was being used. Trigger matches .input styling; popover hosts a filter input + list.
// Keyboard: Enter/ArrowDown/click to open, Esc to close, ArrowUp/Down to highlight,
// Enter to commit. Click-outside closes. Search input auto-hides for small lists.
//
// The popover renders via a portal to document.body so it escapes overflow
// clipping when the trigger lives inside a scrollable container (e.g. modals).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export type SearchSelectOption = {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  // Threshold below which the search input is hidden (keeps tiny enums clean).
  searchThreshold?: number;
  // Optional id for label association.
  id?: string;
};

const SEARCH_THRESHOLD_DEFAULT = 2;

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  allowClear = false,
  disabled = false,
  className = '',
  searchThreshold = SEARCH_THRESHOLD_DEFAULT,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Popover position is computed from the trigger rect each time the popover
  // opens, and re-computed on scroll/resize so it stays attached.
  const [pos, setPos] = useState<{ left: number; top: number; width: number; drop: 'down' | 'up' }>({ left: 0, top: 0, width: 0, drop: 'down' });

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const showSearch = options.length > searchThreshold;

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false));
  }, [options, query]);

  // Close on outside click. Popover lives in a portal, so we check both the
  // trigger wrapper AND the popover element to avoid closing on inside clicks.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Reset query + initial highlight when opened; focus search.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const i = options.findIndex((o) => o.value === value);
    setHighlight(i >= 0 ? i : 0);
    const t = window.setTimeout(() => (showSearch ? inputRef.current : triggerRef.current)?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, options, value, showSearch]);

  // Compute popover position from the trigger rect. Re-runs on scroll/resize
  // (capture-phase scroll catches scrolling inside the parent modal too).
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const drop: 'down' | 'up' = below < 280 && r.top > below ? 'up' : 'down';
      setPos({ left: r.left, top: drop === 'down' ? r.bottom + 4 : r.top - 4, width: r.width, drop });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  // Reset highlight when filter changes.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Clamp highlight if the filtered list shrinks (e.g., the parent removed
  // options while we're open) so Enter doesn't try to commit an undefined.
  useEffect(() => {
    if (highlight > Math.max(0, filtered.length - 1)) {
      setHighlight(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlight]);

  // Keep highlighted item scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[highlight];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  function onTriggerKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    } else if (allowClear && (e.key === 'Backspace' || e.key === 'Delete') && value) {
      e.preventDefault();
      onChange('');
    }
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(Math.max(0, filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt && !opt.disabled) commit(opt.value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`input flex items-center justify-between gap-2 text-left ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span className={`flex-1 truncate ${selected ? '' : 'text-muted'}`}>
          {selected ? (
            <>
              <span>{selected.label}</span>
              {selected.sublabel && <span className="text-muted"> · {selected.sublabel}</span>}
            </>
          ) : (
            placeholder
          )}
        </span>
        {allowClear && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="rounded p-0.5 text-muted hover:bg-paper hover:text-ink"
            title="Clear"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          className="card fixed z-[60] overflow-hidden p-0 shadow-lg"
          style={{
            left: pos.left,
            top: pos.drop === 'down' ? pos.top : undefined,
            bottom: pos.drop === 'up' ? window.innerHeight - pos.top : undefined,
            width: pos.width,
          }}
          onKeyDown={onListKey}
        >
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search size={14} className="text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey}
                placeholder="Search…"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          )}
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1" role="listbox" tabIndex={-1}>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted">No matches</div>
            ) : (
              <ul className="m-0 list-none p-0">
                {filtered.map((opt, i) => {
                  const isHi = i === highlight;
                  const isSel = opt.value === value;
                  return (
                    <li
                      key={opt.value}
                      ref={(el) => (itemRefs.current[i] = el)}
                      role="option"
                      aria-selected={isSel}
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (!opt.disabled) commit(opt.value);
                      }}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                        isHi ? 'bg-copper-soft text-ink' : 'text-ink'
                      } ${opt.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <span className="flex-1 truncate">
                        <span className={isSel ? 'font-semibold' : ''}>{opt.label}</span>
                        {opt.sublabel && <span className="text-muted"> · {opt.sublabel}</span>}
                      </span>
                      {isSel && <Check size={14} className="text-copper" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
