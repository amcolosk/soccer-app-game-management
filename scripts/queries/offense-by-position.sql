-- Sample analytical queries over the CSVs written by
-- scripts/export-analytics-data.ts: "which positions/players create the most
-- offense?" (goals scored, assists, and shots on target -- attributed to
-- whichever position the player was actually playing at that moment, the
-- same recency-tie-break lookup as goals-against-by-position.sql).
--
-- "On target" is derived from the unified Shot.outcome enum
-- (GOAL/SAVED/BLOCKED/WIDE) rather than a separate onTarget boolean: a shot
-- that produced a GOAL or forced a SAVE reached the frame, so outcome IN
-- ('GOAL', 'SAVED') is the on-target set; BLOCKED/WIDE are off-target.
--
-- Run after exporting, from the repo root:
--   duckdb -c ".read scripts/queries/offense-by-position.sql"
--
-- Unlike the defensive query (which asks "who was on the field"), here the
-- scoring/assisting/shooting player is already known (Goal.scorerId /
-- Goal.assistId / Shot.playerId) -- we only need *that player's* active
-- PlayTimeRecord at the event's gameSeconds to know what position produced
-- the chance. Same substitution-boundary tie-break as the defensive query:
-- when two records overlap the same second, the one with the latest
-- startGameSeconds wins.

WITH goals_for AS (
    SELECT id AS goal_id, "gameId" AS game_id, "gameSeconds" AS game_seconds, "scorerId" AS player_id
    FROM read_csv_auto('analytics-export/goals.csv')
    WHERE "scoredByUs" = true AND "scorerId" IS NOT NULL AND "scorerId" != ''
),
scorer_position AS (
    SELECT
        gf.goal_id,
        ptr."positionId" AS position_id,
        row_number() OVER (PARTITION BY gf.goal_id ORDER BY ptr."startGameSeconds" DESC) AS recency_rank
    FROM goals_for gf
    JOIN read_csv_auto('analytics-export/play_time_records.csv') ptr
        ON ptr."gameId" = gf.game_id
        AND ptr."playerId" = gf.player_id
        AND ptr."startGameSeconds" <= gf.game_seconds
        AND (ptr."endGameSeconds" IS NULL OR ptr."endGameSeconds" >= gf.game_seconds)
)
SELECT
    fp."positionName" AS position_name,
    fp."abbreviation" AS abbreviation,
    count(*) AS goals_scored
FROM scorer_position sp
JOIN read_csv('analytics-export/formation_positions.csv',
    columns={'id': 'VARCHAR', 'formationId': 'VARCHAR', 'positionName': 'VARCHAR', 'abbreviation': 'VARCHAR', 'role': 'VARCHAR'}) fp
    ON fp.id = sp.position_id
WHERE sp.recency_rank = 1
GROUP BY fp."positionName", fp."abbreviation"
ORDER BY goals_scored DESC;

WITH assists_for AS (
    SELECT id AS goal_id, "gameId" AS game_id, "gameSeconds" AS game_seconds, "assistId" AS player_id
    FROM read_csv_auto('analytics-export/goals.csv')
    WHERE "scoredByUs" = true AND "assistId" IS NOT NULL AND "assistId" != ''
),
assister_position AS (
    SELECT
        af.goal_id,
        ptr."positionId" AS position_id,
        row_number() OVER (PARTITION BY af.goal_id ORDER BY ptr."startGameSeconds" DESC) AS recency_rank
    FROM assists_for af
    JOIN read_csv_auto('analytics-export/play_time_records.csv') ptr
        ON ptr."gameId" = af.game_id
        AND ptr."playerId" = af.player_id
        AND ptr."startGameSeconds" <= af.game_seconds
        AND (ptr."endGameSeconds" IS NULL OR ptr."endGameSeconds" >= af.game_seconds)
)
SELECT
    fp."positionName" AS position_name,
    fp."abbreviation" AS abbreviation,
    count(*) AS assists
FROM assister_position ap
JOIN read_csv('analytics-export/formation_positions.csv',
    columns={'id': 'VARCHAR', 'formationId': 'VARCHAR', 'positionName': 'VARCHAR', 'abbreviation': 'VARCHAR', 'role': 'VARCHAR'}) fp
    ON fp.id = ap.position_id
WHERE ap.recency_rank = 1
GROUP BY fp."positionName", fp."abbreviation"
ORDER BY assists DESC;

WITH shots_on_target AS (
    SELECT id AS shot_id, "gameId" AS game_id, "gameSeconds" AS game_seconds, "playerId" AS player_id
    FROM read_csv_auto('analytics-export/shots.csv')
    WHERE "takenByUs" = true AND "outcome" IN ('GOAL', 'SAVED')
),
shooter_position AS (
    SELECT
        sot.shot_id,
        ptr."positionId" AS position_id,
        row_number() OVER (PARTITION BY sot.shot_id ORDER BY ptr."startGameSeconds" DESC) AS recency_rank
    FROM shots_on_target sot
    JOIN read_csv_auto('analytics-export/play_time_records.csv') ptr
        ON ptr."gameId" = sot.game_id
        AND ptr."playerId" = sot.player_id
        AND ptr."startGameSeconds" <= sot.game_seconds
        AND (ptr."endGameSeconds" IS NULL OR ptr."endGameSeconds" >= sot.game_seconds)
)
SELECT
    fp."positionName" AS position_name,
    fp."abbreviation" AS abbreviation,
    count(*) AS shots_on_target
FROM shooter_position shp
JOIN read_csv('analytics-export/formation_positions.csv',
    columns={'id': 'VARCHAR', 'formationId': 'VARCHAR', 'positionName': 'VARCHAR', 'abbreviation': 'VARCHAR', 'role': 'VARCHAR'}) fp
    ON fp.id = shp.position_id
WHERE shp.recency_rank = 1
GROUP BY fp."positionName", fp."abbreviation"
ORDER BY shots_on_target DESC;
