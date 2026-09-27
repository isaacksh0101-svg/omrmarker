interface Props {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  const pageNumbers = Array.from(new Set([1, totalPages, page - 1, page, page + 1]))
    .filter((number) => number >= 1 && number <= totalPages)
    .sort((a, b) => a - b);
  return (
    <div className="mt-3 flex items-center justify-center gap-1 border-t border-line pt-3 text-xs">
      <button
        type="button"
        disabled={page <= 1}
        className="rounded-lg px-2 py-1 font-bold text-ink-soft hover:bg-bg disabled:opacity-30"
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      {pageNumbers.map((number, index) => (
        <span key={number} className="flex items-center gap-1">
          {index > 0 && number - pageNumbers[index - 1] > 1 && <span className="px-0.5 text-ink-soft">…</span>}
          <button
            type="button"
            className={`h-7 min-w-7 rounded-lg px-1 font-bold ${
              page === number ? 'bg-accent text-white' : 'text-ink-soft hover:bg-bg'
            }`}
            onClick={() => onChange(number)}
          >
            {number}
          </button>
        </span>
      ))}
      <button
        type="button"
        disabled={page >= totalPages}
        className="rounded-lg px-2 py-1 font-bold text-ink-soft hover:bg-bg disabled:opacity-30"
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </div>
  );
}
