import type { LucideIcon } from 'lucide-react';

/** A filter above a list: an icon, its name, and a select with the choice in bold. */
export function FilterSelect({
  Icon,
  label,
  value,
  onChange,
  options,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="relative inline-flex h-11 max-w-full items-center gap-2 rounded-lg border border-border-strong bg-surface pr-3 pl-3 text-label text-muted focus-within:outline-2 focus-within:outline-brand sm:h-10">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="shrink-0">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-4 font-semibold text-text outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3 text-meta">
        ⌄
      </span>
    </label>
  );
}
