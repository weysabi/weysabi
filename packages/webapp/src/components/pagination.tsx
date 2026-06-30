import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Range of page numbers to show around current page */
const WINDOW = 2;

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(page, totalPages, WINDOW);

  return (
    <nav className="flex items-center justify-center gap-1 pt-6" aria-label="Pagination">
      <button
        onClick={() => onPageChange(1)}
        disabled={page === 1}
        className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
        aria-label="First page"
      >
        <ChevronsLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-2 text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`min-w-[2rem] rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              p === page
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        onClick={() => onPageChange(totalPages)}
        disabled={page === totalPages}
        className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Last page"
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

function getPageNumbers(current: number, total: number, window: number): (number | "...")[] {
  if (total <= window * 2 + 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [];

  // Always show first page
  pages.push(1);

  const start = Math.max(2, current - window);
  const end = Math.min(total - 1, current + window);

  if (start > 2) pages.push("...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("...");

  // Always show last page
  if (total > 1) pages.push(total);

  return pages;
}
