export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PaginationMeta {
  mode: 'cursor' | 'page';
  limit: number;
  /** cursor mode */
  nextCursor?: string | null;
  hasMore?: boolean;
  /** page mode */
  page?: number;
  total?: number;
  totalPages?: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}
