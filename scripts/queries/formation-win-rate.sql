-- Sample analytical query over the CSVs written by
-- scripts/export-analytics-data.ts: "which formation actually wins more?"
--
-- Run after exporting, from the repo root:
--   duckdb -c ".read scripts/queries/formation-win-rate.sql"
--
-- Team.formationId is a mutable current pointer, not a historical record of
-- what a given game was played in, so it can't be trusted for past games
-- once a coach has changed formations. Instead this derives each game's
-- starting formation from what was actually used: LineupAssignment rows
-- with isStarter = true carry a positionId that is (for current-era writes)
-- a FormationPosition id, same precedent as getCurrentGoalkeeperId in
-- playTimeCalculations.ts, so FormationPosition.formationId tells you which
-- formation a game's starters actually came from. If a game's starters
-- ever mix ids from more than one formation (formation swap mid-lineup-entry,
-- or a data anomaly), the most-referenced formationId wins the tie-break.
--
-- Only completed games are counted: Game.ourScore/opponentScore is only
-- meaningful once the game is finished (per CLAUDE.md, it's not maintained
-- live -- see gameCalculations.ts's computeScoreFromGoals for the live
-- equivalent, not needed here since we're looking at settled results).
--
-- DuckDB's read_csv_auto sniffs column types from a sample of the data, and
-- formation names like "4-3-3" get misread as dates without an explicit
-- schema (verified against fixtures containing a "4-3-3"/"4-4-2" pair) --
-- hence the explicit read_csv(..., columns={...}) below for formations.csv.

WITH starter_formation_votes AS (
    SELECT
        la."gameId" AS game_id,
        fp."formationId" AS formation_id,
        count(*) AS vote_count
    FROM read_csv_auto('analytics-export/lineup_assignments.csv') la
    JOIN read_csv_auto('analytics-export/formation_positions.csv') fp ON fp.id = la."positionId"
    WHERE la."isStarter" = true
    GROUP BY la."gameId", fp."formationId"
),
game_formation AS (
    SELECT
        game_id,
        formation_id,
        row_number() OVER (PARTITION BY game_id ORDER BY vote_count DESC) AS rnk
    FROM starter_formation_votes
),
completed_games AS (
    SELECT id AS game_id, "ourScore" AS our_score, "opponentScore" AS opponent_score
    FROM read_csv_auto('analytics-export/games.csv')
    WHERE status = 'completed'
)
SELECT
    f.name AS formation_name,
    count(*) AS games_played,
    sum(CASE WHEN cg.our_score > cg.opponent_score THEN 1 ELSE 0 END) AS wins,
    sum(CASE WHEN cg.our_score < cg.opponent_score THEN 1 ELSE 0 END) AS losses,
    sum(CASE WHEN cg.our_score = cg.opponent_score THEN 1 ELSE 0 END) AS draws,
    round(sum(CASE WHEN cg.our_score > cg.opponent_score THEN 1 ELSE 0 END) * 1.0 / count(*), 3) AS win_rate
FROM game_formation gf
JOIN completed_games cg ON cg.game_id = gf.game_id
JOIN read_csv('analytics-export/formations.csv', columns={'id': 'VARCHAR', 'name': 'VARCHAR'}) f
    ON f.id = gf.formation_id
WHERE gf.rnk = 1
GROUP BY f.name
ORDER BY win_rate DESC;
