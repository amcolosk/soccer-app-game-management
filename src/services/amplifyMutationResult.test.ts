import { describe, expect, it } from 'vitest';
import { assertMutationResult } from './amplifyMutationResult';

describe('assertMutationResult', () => {
  it('returns result.data when the mutation succeeds', () => {
    const result = assertMutationResult(
      { data: { id: 'game-1' }, errors: undefined },
      'Failed to do the thing',
    );

    expect(result).toEqual({ id: 'game-1' });
  });

  it('throws with the server error message when result.errors is present', () => {
    expect(() =>
      assertMutationResult(
        { data: null, errors: [{ message: 'Access denied: caller is not a coach on this team' }] },
        'Failed to do the thing',
      )
    ).toThrow(/access denied: caller is not a coach on this team/i);
  });

  it('throws the fallback message when result.data is falsy with no errors', () => {
    expect(() =>
      assertMutationResult({ data: null, errors: undefined }, 'Failed to do the thing')
    ).toThrow(/failed to do the thing/i);
  });
});
