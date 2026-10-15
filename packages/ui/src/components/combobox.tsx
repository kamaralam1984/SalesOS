'use client';
import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useFieldContext } from './form';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  clearLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  id?: string;
  className?: string;
  /** Called as the user types - use for server-side search. */
  onQueryChange?: (q: string) => void;
  name?: string;
}

/** Accessible single-select combobox (ARIA 1.2 editable combobox with listbox popup). */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  emptyText = 'No matches',
  clearLabel = 'Clear selection',
  disabled,
  loading,
  id,
  className,
  onQueryChange,
  name,
}: ComboboxProps) {
  const ctx = useFieldContext();
  const inputId = id ?? ctx?.id;
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || onQueryChange) return options;
    return options.filter((o) => (o.label + ' ' + (o.description ?? '')).toLowerCase().includes(q));
  }, [options, query, onQueryChange]);

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function commit(opt: ComboboxOption) {
    if (opt.disabled) return;
    onValueChange?.(opt.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) commit(opt);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(filtered.length - 1);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        aria-describedby={ctx?.describedBy}
        aria-invalid={ctx?.invalid || undefined}
        aria-required={ctx?.required || undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          onQueryChange?.(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'h-11 w-full rounded-md border bg-surface px-3 pr-16 text-[0.9375rem] text-ink shadow-xs placeholder:text-ink-500 md:h-10',
          'hover:border-ink-400 focus-visible:border-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600/30 focus-visible:outline-offset-0 disabled:bg-ivory-200',
          ctx?.invalid ? 'border-red-600' : 'border-control',
        )}
      />
      <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
        {selected && !disabled && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => onValueChange?.(null)}
            className="inline-flex size-8 items-center justify-center rounded text-ink-500 hover:bg-ivory-200 hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
        <ChevronsUpDown aria-hidden="true" className="mr-1.5 size-4 text-ink-500" />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="ui-pop absolute z-40 mt-1.5 max-h-64 w-full overflow-auto rounded-lg border border-line bg-raised p-1 shadow-md"
        >
          {loading && (
            <li role="presentation" className="px-3 py-2 text-sm text-muted">
              Loading…
            </li>
          )}
          {!loading && filtered.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-muted">
              {emptyText}
            </li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o)}
              className={cn(
                'flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm transition-[background-color,box-shadow] duration-150',
                i === active && 'bg-champagne-100 shadow-[inset_2px_0_0_var(--color-gold-500,#c9a03a)]',
                o.value === value && i !== active && 'bg-ivory-100',
                o.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-ink">{o.label}</span>
                {o.description && (
                  <span className="block truncate text-xs text-muted">{o.description}</span>
                )}
              </span>
              {o.value === value && (
                <Check aria-hidden="true" className="size-4 shrink-0 text-gold-700" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
