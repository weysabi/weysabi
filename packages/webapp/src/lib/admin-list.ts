/**
 * Build a paginated list URL with filter parameters.
 * All admin list endpoints use limit/offset pagination.
 */
export function buildListUrl(
  base: string,
  page: number,
  limit: number,
  filters: Record<string, string | undefined> = {}
): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String((page - 1) * limit));
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `${base}?${params.toString()}`;
}
