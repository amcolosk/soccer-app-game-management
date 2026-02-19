import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { sortRosterByNumber } from "../utils/playerUtils";
import type { FormationPosition, PlayerWithRoster } from "../types/schema";

export type { PlayerWithRoster } from "../types/schema";

const client = generateClient<Schema>();

/**
 * Custom hook to load team roster and formation positions with real-time updates.
 * Handles DynamoDB eventual consistency automatically using observeQuery.
 * 
 * @param teamId - The team ID to load roster for
 * @param formationId - The formation ID to load positions for
 * @returns Object containing players with roster data and formation positions
 */
export function useTeamData(teamId: string, formationId: string | null | undefined) {
  const [players, setPlayers] = useState<PlayerWithRoster[]>([]);
  const [positions, setPositions] = useState<FormationPosition[]>([]);

  useEffect(() => {
    let playerSub: any;
    
    // Set up reactive subscription for roster and players (handles eventual consistency)
    const rosterSub = client.models.TeamRoster.observeQuery({
      filter: { teamId: { eq: teamId } },
    }).subscribe({
      next: async (rosterData) => {
        const rosters = sortRosterByNumber([...rosterData.items]);

        // Clean up previous player subscription if it exists
        if (playerSub) {
          playerSub.unsubscribe();
        }

        // Extract player IDs from roster for client-side filtering.
        // We subscribe to ALL players without server-side filters because
        // AppSync subscriptions have a maximum of 10 filters, and teams
        // commonly have more than 10 players on the roster.
        const rosterPlayerIds = new Set(rosters.map(r => r.playerId));

        if (rosterPlayerIds.size > 0) {
          playerSub = client.models.Player.observeQuery().subscribe({
            next: (playerData) => {
              const teamPlayers = playerData.items.filter(p => rosterPlayerIds.has(p.id));

              // Merge roster with player data (O(n*m) but both are small now)
              const playersWithRoster: PlayerWithRoster[] = rosters
                .map((roster) => {
                  const player = teamPlayers.find((p) => p.id === roster.playerId);
                  if (!player) return null;
                  return {
                    ...player,
                    playerNumber: roster.playerNumber,
                    preferredPositions: roster.preferredPositions || undefined,
                  };
                })
                .filter((p) => p !== null) as PlayerWithRoster[];

              setPlayers(playersWithRoster);
            },
          });
        } else {
          // No roster entries, set empty players
          setPlayers([]);
        }
      },
    });
    
    // Set up reactive subscription for positions (handles eventual consistency)
    let positionSub: any;
    if (formationId) {
      positionSub = client.models.FormationPosition.observeQuery({
        filter: { formationId: { eq: formationId } },
      }).subscribe({
        next: (data) => {
          const sortedPositions = [...data.items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          setPositions(sortedPositions);
        },
      });
    }
    
    return () => {
      rosterSub.unsubscribe();
      if (playerSub) playerSub.unsubscribe();
      if (positionSub) positionSub.unsubscribe();
    };
  }, [teamId, formationId]);

  return { players, positions };
}
