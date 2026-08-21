/**
 * Shared result-unwrapping helper for Amplify Gen2 custom mutations that
 * `.returns(a.ref(<Model>))` a typed model (not `a.json()` — see
 * cascadeDeleteService.ts's assertMutationSuccess for the AWSJSON-string
 * variant, which has a genuinely different contract and is not consolidated
 * here). Used by teamLifecycleService.ts and gameService.ts.
 */
export function assertMutationResult<T>(
  result: { data?: T | null; errors?: Array<{ message?: string }> },
  fallbackMessage: string,
): NonNullable<T> {
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || fallbackMessage);
  }
  if (!result.data) {
    throw new Error(fallbackMessage);
  }
  return result.data as NonNullable<T>;
}
