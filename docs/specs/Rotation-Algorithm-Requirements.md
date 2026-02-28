# Soccer Rotation App: Software Requirements

## 1. Hard Constraints (Strict Rules)
These are rules the system must never break when generating a rotation schedule.

* **Rule 1.1 - The "Cloning" Rule:** A player can only occupy one position on the field at any given time.
* **Rule 1.2 - Substitution Flow:** All substitutions must occur between the Field and the Bench. A player already on the field cannot be moved directly to another field position during a substitution (no field-to-field shuffling).
* **Rule 1.3 - Minimum Playtime Guarantee:** Every player on the roster must be scheduled for a minimum total play time equal to or greater than 50% of their available game time. (when they are present)
* **Rule 1.4 - Goalie Halftime Lock:** Substitutions for the Goalie position are strictly restricted to the halftime interval. Goalies cannot be subbed in or out during the run of play in either half.
* **Rule 1.5 - Goalie Preference Lock:** A player cannot be scheduled in the Goalie position unless "Goalie" is explicitly listed in their profile as a preferred position. No exceptions.

---

## 2. Soft Constraints & Logic Exceptions (Preferences & Balancing)
These are rules where the system needs to weigh options and make the "best" choice based on the game state.

* **Rule 2.1 - Positional Playtime Prioritization:** The system shall prioritize subbing players into their listed "preferred positions." 
* **Rule 2.2 - Out-of-Position Exception:** If a player is mathematically at risk of not meeting the 50% minimum playtime requirement (Rule 1.3), the system may override Rule 2.1 and sub them into a non-preferred position (excluding Goalie, per Rule 1.5).
* **Rule 2.3 - Positional Fatigue / Sub Frequency:** The system shall use different maximum continuous shift lengths based on position groups. 
    * Strikers and Wings shall have a shorter continuous shift length (higher substitution frequency).
    * Defenders should have a longer continuous shift length (lower substitution frequency).
* **Rule 2.4 - Playtime Equality:** The rotation algorithm shall attempt to minimize the variance in total playtime among all non-goalie players by the end of the game. (i.e., The system should aim to give everyone roughly equal minutes, treating the 50% rule as a floor, not a target).
* **Rule 2.5 - Play per Half:** The rotation algorithm shall attempt to have all players on the field at least once each half of the game.  

# Test Suite: 5v5 Rotation Algorithm (7-Player Roster)

**Baseline Testing Environment:**
* **Game Duration:** 40 minutes (Two 20-minute halves)
* **Minimum Playtime (50%):** 20 minutes per player
* **Total Available Minutes:** 200 minutes (5 positions × 40 minutes)
* **Average Playtime Target:** ~28.5 minutes per player (200 mins ÷ 7 players)
* **Positions:** 1 Goalie (GK), 2 Defenders (DEF), 2 Forwards/Strikers (FWD)
* **Rotation Interval:** 5 minutes

---

## Part 1: Standard Scenarios (High-Level Constraints)

**TC-01: The "Happy Path" (Baseline Fair Rotation)**
* **Objective:** Validate that the system can generate a balanced rotation when all players are flexible.
* **Setup:** All 7 players are present for the full game and have all positions (GK, DEF, FWD) listed as preferred.
* **Expected Result:** * (Rule 1.3, 2.4) All 7 players play between 25 and 30 minutes.
    * (Rule 2.5) All 7 players are scheduled for at least one shift in the 1st half and one shift in the 2nd half.
    * (Rule 1.4) Only one GK substitution occurs (exactly at halftime).

**TC-02: Strict Goalie Constraints**
* **Objective:** Validate the Goalie Preference Lock (Rule 1.5) and Halftime Lock (Rule 1.4).
* **Setup:** Player A and Player B are the *only* players with "GK" in their preferred positions. Both present full game.
* **Expected Result:** * (Rule 1.5) Only Player A and Player B are ever assigned to the GK position.
    * (Rule 1.4) Player A plays GK for the entirety of one half; Player B plays GK for the entirety of the other half. Neither is subbed in/out of the GK position during the run of play.

**TC-03: Substitution Mechanics (Anti-Shuffling)**
* **Objective:** Validate Rule 1.1 (Cloning) and Rule 1.2 (Sub Flow).
* **Setup:** Player C is playing DEF in minute 10. The system triggers a substitution where Player C is needed at FWD.
* **Expected Result:** * (Rule 1.1) The schedule never shows Player C occupying two positions at the same timestamp.
    * (Rule 1.2) Player C cannot go directly from DEF to FWD. The system must route Player C to the bench first, bringing a benched player on to replace them at DEF, before scheduling Player C back onto the field at FWD in a later shift.

**TC-04: The 50% Playtime Override**
* **Objective:** Validate that the hard minimum playtime (Rule 1.3) successfully overrides the soft preferred position constraint (Rule 2.1).
* **Setup:** All players present full game. Player D has *only* FWD listed as a preferred position. The algorithm has already filled the FWD slots with other players to the point where Player D only has 15 minutes of scheduled time.
* **Expected Result:** * (Rule 2.2) The system assigns Player D to play DEF for at least 5 minutes to satisfy their 20-minute minimum (50% of 40 mins), ignoring their positional preference.
    * (Rule 1.5) The system does *not* assign Player D to GK to make up these minutes.

**TC-05: Positional Fatigue / Shift Lengths**
* **Objective:** Validate that shift durations respect positional fatigue (Rule 2.3).
* **Setup:** FWD max shift length is configured to 5 minutes. DEF max shift length is configured to 10 minutes.
* **Expected Result:** * (Rule 2.3) A player scheduled at FWD is sent to the bench after a maximum of 5 continuous minutes.
    * (Rule 2.3) A player scheduled at DEF remains on the field for up to 10 continuous minutes before requiring a substitution.

**TC-06: The "Single Goalie" Stress Test**
* **Objective:** Validate that a dedicated goalie doesn't break the playtime equality of the field players.
* **Setup:** All players present full game. Player E is the *only* player with "GK" preferred. 
* **Expected Result:** * (Rule 1.5) Player E plays GK for the entire 40-minute game. 
    * (Rule 2.4) The remaining 6 players share the 4 field positions (160 available minutes). All 6 field players should have roughly 25-28 minutes of playtime, safely clearing their 20-minute minimums.

---

## Part 2: Edge Cases (Game Day Chaos)

**TC-07: Mid-Game Injury / Absence Recalculation**
* **Objective:** Validate the system's ability to adjust when a player is removed mid-game and respect proportional playtime.
* **Setup:** Exactly 10 minutes into the first half, Player F is marked as "injured/unavailable" for the remainder of the game. 
* **Expected Result:** * The system recalculates the remaining 30 minutes for a 6-player roster.
    * (Rule 1.3) Player F's *available* time was 10 minutes. 50% of 10 minutes is 5 minutes. The system verifies they were scheduled for at least 5 minutes prior to injury, and throws no errors for falling short of the standard 20-minute game minimum.
    * (Rule 1.3) The remaining 6 players absorb the extra minutes and still meet their own 20-minute minimum requirements.

**TC-08: The Late Arrival**
* **Objective:** Validate proportional playtime guarantees for a player who misses the first half.
* **Setup:** Player G is marked as "absent" for the 1st half and "present" starting exactly at halftime.
* **Expected Result:** * (Rule 1.3) Player G's *available* time is 20 minutes (the 2nd half). To meet the 50% minimum, Player G must be scheduled to play at least 10 minutes in the second half.
    * (Rule 2.5) Player G does not trigger an error for missing the first half, as they were not available.

**TC-09: No Willing Goalie (Validation Failure)**
* **Objective:** Validate that Rule 1.5 (Goalie Lock) acts as a hard stop if requirements cannot be met.
* **Setup:** Zero players out of the 7 have "GK" listed in their preferred positions.
* **Expected Result:** * (Rule 1.5) The algorithm fails to generate a valid rotation and throws a specific error/warning (e.g., "Cannot schedule game: No eligible goalies available"), requiring a manual override of a player's profile before proceeding.

**TC-10: The Short Bench (Exactly 5 Players)**
* **Objective:** Validate the algorithm handles a scenario with zero available substitutes.
* **Setup:** Only 5 players are marked as "present." One of them has "GK" preferred.
* **Expected Result:** * All 5 players are scheduled for 40 minutes (100% playtime).
    * (Rule 2.3) Shift length maximums and positional fatigue rules are ignored, as substitutions are impossible.