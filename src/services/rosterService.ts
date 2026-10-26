import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { Team } from "../types/schema";
import { deletePlayerCascade } from "./cascadeDeleteService";
import {
  BIRTH_YEAR_MAX_FN,
  BIRTH_YEAR_MIN,
  isValidPlayerNumber,
  parseBirthYear,
  parseJerseyNumber,
} from "../utils/validation";
import { logError } from "../utils/errorHandler";

const client = generateClient<Schema>();

/** Thrown for user-correctable input problems; the message is safe to show in a toast. */
export class RosterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterValidationError";
  }
}

/**
 * Parses the raw birth-year / jersey-number strings from a form into numbers.
 * Blank means "not provided" (undefined); invalid input throws RosterValidationError
 * so a blank can never reach the API as NaN.
 */
export function parseOptionalPlayerNumbers(raw: { birthYear: string; jerseyNumber: string }): {
  birthYear: number | undefined;
  jerseyNumber: number | undefined;
} {
  const birthYear = parseBirthYear(raw.birthYear);
  if (birthYear === null) {
    throw new RosterValidationError(`Birth year must be between ${BIRTH_YEAR_MIN} and ${BIRTH_YEAR_MAX_FN()}`);
  }
  const jerseyNumber = parseJerseyNumber(raw.jerseyNumber);
  if (jerseyNumber === null) {
    throw new RosterValidationError("Please enter a valid player number (1-99)");
  }
  return { birthYear, jerseyNumber };
}

interface CreatePlayerOnRosterInput {
  team: Pick<Team, "id" | "coaches">;
  currentUserId: string;
  firstName: string;
  lastName: string;
  birthYear?: number;
  jerseyNumber?: number;
  preferredPositionIds?: string[];
  isGuest: boolean;
  /** Jersey numbers already taken on this team's roster. */
  existingNumbers: number[];
}

interface CreatePlayerOnRosterResult {
  playerId: string;
  rosterId: string;
}

/**
 * Creates a brand-new Player and puts them on a team's roster in one step.
 *
 * Both records carry the team's full coach list (plus the creator) so a
 * co-coach can read the Player — useTeamData drops roster rows whose Player it
 * can't read. Player deletion is disallowed on the model, so a failed roster
 * create is rolled back through deletePlayerCascade.
 */
export async function createPlayerOnRoster(
  input: CreatePlayerOnRosterInput,
): Promise<CreatePlayerOnRosterResult> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    throw new RosterValidationError("Please enter first name and last name");
  }

  const { jerseyNumber } = input;
  if (jerseyNumber !== undefined) {
    if (!isValidPlayerNumber(jerseyNumber)) {
      throw new RosterValidationError("Please enter a valid player number (1-99)");
    }
    if (input.existingNumbers.includes(jerseyNumber)) {
      throw new RosterValidationError("This player number is already in use on this team");
    }
  }

  const teamCoaches = (input.team.coaches ?? []).filter((c): c is string => typeof c === "string");
  const coaches = Array.from(new Set([...teamCoaches, input.currentUserId]));

  const playerResult = await client.models.Player.create({
    firstName,
    lastName,
    birthYear: input.birthYear,
    coaches,
  });
  const playerId = playerResult.data?.id;
  if (playerResult.errors?.length || !playerId) {
    throw new Error(playerResult.errors?.[0]?.message || "Failed to create player");
  }

  try {
    const rosterResult = await client.models.TeamRoster.create({
      teamId: input.team.id,
      playerId,
      // Omit rather than send null when there's no number.
      ...(jerseyNumber !== undefined ? { playerNumber: jerseyNumber } : {}),
      preferredPositions: input.preferredPositionIds?.length
        ? input.preferredPositionIds.join(", ")
        : undefined,
      isGuest: input.isGuest,
      coaches: teamCoaches,
    });
    const rosterId = rosterResult.data?.id;
    if (rosterResult.errors?.length || !rosterId) {
      throw new Error(rosterResult.errors?.[0]?.message || "Failed to add player to roster");
    }
    return { playerId, rosterId };
  } catch (error) {
    try {
      await deletePlayerCascade(playerId);
    } catch (rollbackError) {
      logError("Player delete rollback after TeamRoster.create failure", rollbackError);
    }
    throw error;
  }
}
