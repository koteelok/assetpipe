export type QueryLike = string | string[];

export function queryArray(query: QueryLike) {
  return Array.isArray(query) ? [...query] : [query];
}
