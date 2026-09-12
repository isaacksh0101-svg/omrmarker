import { useMemo, useState } from 'react';
import type { StandardOption } from '../../../types';

interface Props {
  options: StandardOption[];
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
}

export function StandardsPicker({ options, selectedCodes, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.filter((o) => selectedCodes.includes(o.code)),
    [options, selectedCodes],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return options.slice(0, 30);
    const q = query.trim();
    return options.filter((o) => o.code.includes(q) || o.statement.includes(q)).slice(0, 30);
  }, [options, query]);

  function toggle(code: string) {
    const next = selectedCodes.includes(code)
      ? selectedCodes.filter((c) => c !== code)
      : [...selectedCodes, code];
    onChange(next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-ink-soft">성취기준</span>
        {selected.map((s) => (
          <span
            key={s.code}
            className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-xs font-bold text-accent-ink"
          >
            {s.code}
            <button onClick={() => toggle(s.code)} className="hover:text-danger">
              ✕
            </button>
          </span>
        ))}
        <button
          className="rounded-full border border-dashed border-line px-2 py-1 text-xs text-ink-soft hover:border-accent hover:text-accent"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '닫기' : '+ 추가'}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-line bg-bg p-2">
          <input
            autoFocus
            className="w-full rounded-lg border border-line bg-panel px-2 py-1 text-sm text-ink outline-none focus:border-accent"
            placeholder="코드 또는 내용으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-2 max-h-48 overflow-y-auto">
            {filtered.map((s) => (
              <label
                key={s.code}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-panel"
              >
                <input
                  type="checkbox"
                  checked={selectedCodes.includes(s.code)}
                  onChange={() => toggle(s.code)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-bold text-ink">[{s.code}]</span>{' '}
                  <span className="text-ink-soft">{s.statement}</span>
                </span>
              </label>
            ))}
            {filtered.length === 0 && <p className="px-2 py-1.5 text-xs text-ink-soft">검색 결과 없음</p>}
          </div>
        </div>
      )}
    </div>
  );
}
