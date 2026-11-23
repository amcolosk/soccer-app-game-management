export interface GuestPlayerFieldValues {
  firstName: string;
  lastName: string;
  birthYear: string;
  jerseyNumber: string;
  preferredPositionIds: string[];
}

export const EMPTY_GUEST_PLAYER_FIELDS: GuestPlayerFieldValues = {
  firstName: "",
  lastName: "",
  birthYear: "",
  jerseyNumber: "",
  preferredPositionIds: [],
};
