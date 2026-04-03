/* eslint-disable @typescript-eslint/no-explicit-any */

type CleanupClient = {
  models: Record<string, {
    list: (opts?: any) => Promise<{ data: Array<{ id: string }>; nextToken?: string | null }>;
    delete: (input: { id: string }) => Promise<unknown>;
  }>;
  mutations: {
    deleteGameSafe: (input: { gameId: string }) => Promise<{ data?: { success?: boolean } | null; errors?: Array<{ message?: string }> }>;
  };
};

const ORPHAN_MODELS = [
  'PlayTimeRecord',
  'Goal',
  'GameNote',
  'Substitution',
  'LineupAssignment',
  'PlannedRotation',
  'GamePlan',
  'PlayerAvailability',
] as const;

export async function cleanupAllDataForE2E(cleanupClient: CleanupClient): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  // Game model deletes are blocked by schema policy; always route through deleteGameSafe.
  let deletedGames = 0;
  let gameNextToken: string | null | undefined = undefined;
  let hasMoreGames = true;

  while (hasMoreGames) {
    try {
      const gameOpts: any = { limit: 1000 };
      if (gameNextToken) gameOpts.nextToken = gameNextToken;

      const response = await (cleanupClient.models.Game as any).list(gameOpts);
      const games = response.data ?? [];

      if (games.length > 0) {
        for (let i = 0; i < games.length; i += 10) {
          const batch = games.slice(i, i + 10);

          const settled = await Promise.allSettled(
            batch.map((game: { id: string }) => cleanupClient.mutations.deleteGameSafe({ gameId: game.id })),
          );

          for (const result of settled) {
            if (result.status === 'fulfilled' && !result.value.errors?.length && result.value.data?.success === true) {
              deletedGames += 1;
            }
          }
        }
      }

      gameNextToken = response.nextToken;
      hasMoreGames = !!gameNextToken;
    } catch {
      hasMoreGames = false;
    }
  }

  results.Game = deletedGames;

  for (const modelName of ORPHAN_MODELS) {
    let deleted = 0;
    let nextToken: string | null | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      try {
        const opts: any = { limit: 1000 };
        if (nextToken) opts.nextToken = nextToken;
        const response = await (cleanupClient.models as any)[modelName].list(opts);

        if (response.data && response.data.length > 0) {
          const items = response.data;
          for (let i = 0; i < items.length; i += 10) {
            const batch = items.slice(i, i + 10);
            await Promise.allSettled(
              batch.map((item: any) =>
                (cleanupClient.models as any)[modelName].delete({ id: item.id }),
              ),
            );
            deleted += batch.length;
          }
        }

        nextToken = response.nextToken;
        hasMore = !!nextToken;
      } catch {
        hasMore = false;
      }
    }

    results[modelName] = deleted;
  }

  return results;
}
