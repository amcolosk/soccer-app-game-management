-- Sample analytical query over the CSVs written by
-- scripts/export-analytics-data.ts: "does how evenly we share minutes
-- correlate with winning or losing?"
--
-- Run after exporting, from the repo root:
--   duckdb -c ".read scripts/queries/play-time-fairness-vs-results.sql"
--
-- Fairness per game is the coefficient of variation (population stddev /
-- mean) of total on-field seconds across the players who actually played
-- that game -- 0 means everyone who played got equal minutes, higher means
-- more concentrated among fewer players. Total seconds per player comes
-- straight from summing PlayTimeRecord's (startGameSeconds, endGameSeconds)
-- intervals -- the source of truth for play time per CLAUDE.md, same table
-- playTimeCalculations.ts's fair-rotation math reads.
--
-- Scope note: this only covers players who saw the field (appeared in
-- PlayTimeRecord for that game). It does not penalize leaving an available
-- bench player unused for the whole game -- that's a roster-composition
-- question, not a play-time-distribution one, and would need
-- LineupAssignment's full roster (including non-starters who were never
-- subbed on, if such rows exist) to answer.
--
-- Only completed games are counted, same reasoning as formation-win-rate.sql.

WITH player_totals AS (
    SELECT
        "gameId" AS game_id,
        "playerId" AS player_id,
        sum(coalesce("endGameSeconds", "startGameSeconds") - "startGameSeconds") AS total_seconds
    FROM read_csv_auto('analytics-export/play_time_records.csv')
    GROUP BY "gameId", "playerId"
),
game_fairness AS (
    SELECT
        game_id,
        avg(total_seconds) AS mean_seconds,
        stddev_pop(total_seconds) AS stddev_seconds,
        CASE WHEN avg(total_seconds) = 0 THEN 0 ELSE stddev_pop(total_seconds) / avg(total_seconds) END AS coeff_variation
    FROM player_totals
    GROUP BY game_id
),
completed_games AS (
    SELECT
        id AS game_id,
        CASE
            WHEN "ourScore" > "opponentScore" THEN 'win'
            WHEN "ourScore" < "opponentScore" THEN 'loss'
            ELSE 'draw'
        END AS outcome
    FROM read_csv_auto('analytics-export/games.csv')
    WHERE status = 'completed'
)
SELECT
    cg.outcome,
    count(*) AS games,
    round(avg(gf.coeff_variation), 4) AS avg_coeff_variation,
    round(min(gf.coeff_variation), 4) AS min_coeff_variation,
    round(max(gf.coeff_variation), 4) AS max_coeff_variation
FROM game_fairness gf
JOIN completed_games cg ON cg.game_id = gf.game_id
GROUP BY cg.outcome
ORDER BY avg_coeff_variation ASC;
