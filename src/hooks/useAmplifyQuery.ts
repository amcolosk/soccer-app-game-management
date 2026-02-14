import { useState, useEffect, useRef, useMemo, type DependencyList } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

/**
 * Model names from the Amplify schema that support observeQuery subscriptions.
 */
export type ModelName = keyof typeof client.models;

interface UseAmplifyQueryOptions<T> {
  filter?: Record<string, any>;
  sort?: (a: T, b: T) => number;
}

/**
 * Reusable hook for Amplify observeQuery subscriptions.
 * Handles subscribe/unsubscribe lifecycle, filter memoization, and optional sorting.
 *
 * @param modelName - Amplify model name (e.g., 'Team', 'Game')
 * @param options - Optional filter and sort configuration
 * @param deps - Dependency array for filter memoization (like useMemo deps)
 * @returns { data, isSynced } - array of model records and sync status
 */
export function useAmplifyQuery<M extends ModelName>(
  modelName: M,
  options?: UseAmplifyQueryOptions<Schema[M]["type"]>,
  deps: DependencyList = [],
): { data: Schema[M]["type"][]; isSynced: boolean } {
  type T = Schema[M]["type"];

  const [data, setData] = useState<T[]>([]);
  const [isSynced, setIsSynced] = useState(false);

  // Store sort in ref so reference changes don't trigger re-subscription
  const sortRef = useRef(options?.sort);
  sortRef.current = options?.sort;

  // Memoize filter based on caller-provided deps to prevent infinite re-subscription loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filter = useMemo(() => options?.filter, deps);

  useEffect(() => {
    setIsSynced(false);

    const queryOptions = filter ? { filter } : undefined;

    const sub = (client.models[modelName] as any)
      .observeQuery(queryOptions)
      .subscribe({
        next: (result: { items: T[]; isSynced: boolean }) => {
          let items = [...result.items];
          if (sortRef.current) {
            items.sort(sortRef.current);
          }
          setData(items);
          setIsSynced(result.isSynced);
        },
      });

    return () => sub.unsubscribe();
  }, [modelName, filter]);

  return { data, isSynced };
}
