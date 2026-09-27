-- Sample analytical query over the CSVs written by
-- scripts/export-analytics-data.ts: "how many goals did each center back
-- leak while in that position?"
--
-- Run after exporting, from the repo root:
--   duckdb -c ".read scripts/queries/goals-against-by-position.sql"
-- (or point DuckDB at a different export dir by editing the paths below)
--
-- How it works: Goal has no link to who was on the field. The game clock is
-- one continuous counter across both halves (src/utils/gameClock.ts), so a
-- conceded goal's gameSeconds can be matched directly against the
-- PlayTimeRecord interval [startGameSeconds, endGameSeconds] active at that
-- moment -- the same "who was in position X at time T" lookup
-- getCurrentGoalkeeperId (src/utils/playTimeCalculations.ts) already does
-- for goalkeeper attribution, generalized to any position. When more than
-- one record overlaps the same second (a substitution landed on the exact
-- goal second), the record with the latest startGameSeconds wins -- the
-- same deterministic tie-break getCurrentGoalkeeperId uses.
--
-- "Center back" isn't a distinct role in the schema (FormationPosition.role
-- is only GOALKEEPER/DEFENDER/MIDFIELDER/FORWARD), so it's matched on the
-- position's own name/abbreviation, which is set per formation -- adjust the
-- WHERE clause below if your formation names it differently.

WITH goals_against AS (
    SELECT id AS goal_id, "gameId" AS game_id, "gameSeconds" AS game_seconds
    FROM read_csv_auto('analytics-export/goals.csv')
    WHERE "scoredByUs" = false
),
on_field_at_goal AS (
    SELECT
        ga.goal_id,
        ptr."playerId" AS player_id,
        ptr."positionId" AS position_id,
        row_number() OVER (
            PARTITION BY ga.goal_id
            ORDER BY ptr."startGameSeconds" DESC
        ) AS recency_rank
    FROM goals_against ga
    JOIN read_csv_auto('analytics-export/play_time_records.csv') ptr
        ON ptr."gameId" = ga.game_id
        AND ptr."startGameSeconds" <= ga.game_seconds
        AND (ptr."endGameSeconds" IS NULL OR ptr."endGameSeconds" >= ga.game_seconds)
)
SELECT
    p."firstName" AS first_name,
    p."lastName" AS last_name,
    count(*) AS goals_conceded_at_center_back
FROM on_field_at_goal ofg
JOIN read_csv_auto('analytics-export/formation_positions.csv') fp
    ON fp.id = ofg.position_id
JOIN read_csv_auto('analytics-export/players.csv') p
    ON p.id = ofg.player_id
WHERE ofg.recency_rank = 1
    AND (
        lower(fp."positionName") LIKE '%center back%'
        OR lower(fp."positionName") LIKE '%centre back%'
        OR lower(fp."abbreviation") = 'cb'
    )
GROUP BY p."firstName", p."lastName"
ORDER BY goals_conceded_at_center_back DESC;
