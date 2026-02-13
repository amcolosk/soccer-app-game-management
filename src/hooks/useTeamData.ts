import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { sortRosterByNumber } from "../utils/playerUtils";

const client = generateClient<Schema>();

type Player = Schema["Player"]["type"];
type FormationPosition = Schema["FormationPosition"]["type"];

export interface PlayerWithRoster extends Player {
  playerNumber?: number;
  preferredPositions?: string;
}

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

        // Extract player IDs from roster for filtered query
        const rosterPlayerIds = rosters.map(r => r.playerId);

        // Only load players that are on this team's roster (no over-fetching)
        if (rosterPlayerIds.length > 0) {
          playerSub = client.models.Player.observeQuery({
            filter: {
              or: rosterPlayerIds.map(id => ({ id: { eq: id } })),
            },
          }).subscribe({
            next: (playerData) => {
              const teamPlayers = playerData.items;

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
