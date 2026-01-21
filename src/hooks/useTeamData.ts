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
        
        // Load all players with observeQuery for real-time updates
        playerSub = client.models.Player.observeQuery().subscribe({
          next: (playerData) => {
            const allPlayers = playerData.items;
            
            // Merge roster with player data
            const playersWithRoster: PlayerWithRoster[] = rosters
              .map((roster) => {
                const player = allPlayers.find((p) => p.id === roster.playerId);
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
