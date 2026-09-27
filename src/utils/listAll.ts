/**
 * Paginated list that fetches ALL records matching a filter.
 * Amplify .list() returns at most one page, and a filter on a non-indexed field is a
 * DynamoDB scan filtered *after* the page limit — so a single page can hold only some
 * (or none) of the matching rows even when more exist. Loop through every page.
 */
export async function listAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: { list: (opts?: any) => Promise<{ data: T[]; nextToken?: string | null }> },
  filter?: Record<string, unknown>,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const opts: { limit: number; filter?: Record<string, unknown>; nextToken?: string } = { limit: 1000 };
    if (filter) opts.filter = filter;
    if (nextToken) opts.nextToken = nextToken;

    const response = await model.list(opts);
    all.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);

  return all;
}
