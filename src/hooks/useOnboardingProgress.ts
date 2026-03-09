import { useMemo } from 'react';
import type { Team, Game, TeamRoster, GamePlan } from '../types/schema';

interface OnboardingStep {
  id: number;
  title: string;
  completed: boolean;
  directionText: string;
}

interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  allComplete: boolean;
}

/**
 * Derives onboarding step completion from live data.
 * All steps evaluate independently — no locking logic.
 * 
 * @param teams - All teams for the current user
 * @param games - All games for the current user
 * @param teamRosters - All roster entries (flat list)
 * @param gamePlans - All game plans for the current user
 * @returns Step completion status and progress summary
 */
export function useOnboardingProgress(
  teams: Team[],
  games: Game[],
  teamRosters: TeamRoster[],
  gamePlans: GamePlan[],
): OnboardingProgress {
  return useMemo(() => {
    // Step completion logic (no locking — all steps show plain complete/incomplete)
    const step1Complete = teams.length >= 1;
    const step2Complete = teamRosters.some(r => teams.some(t => t.id === r.teamId));
    const step3Complete = teams.some(t => t.formationId != null && t.formationId !== '');
    const step4Complete = games.length >= 1;
    const step5Complete = gamePlans.length >= 1;
    const step6Complete = games.some(g => g.status === 'in-progress' || g.status === 'completed');

    const steps: OnboardingStep[] = [
      {
        id: 1,
        title: 'Create your team',
        completed: step1Complete,
        directionText: 'Go to Manage ⚙️ → Teams. Tap "Add Team", give it a name, and choose how many players are on the field.',
      },
      {
        id: 2,
        title: 'Add players to your roster',
        completed: step2Complete,
        directionText: 'Go to Manage ⚙️ → Players. Tap "Add Player" to build your roster. You\'ll need at least as many players as your formation has positions.',
      },
      {
        id: 3,
        title: 'Set your formation',
        completed: step3Complete,
        directionText: 'Go to Manage ⚙️ → Teams, open your team, and assign a formation. Formations define how many players are in each line.',
      },
      {
        id: 4,
        title: 'Schedule a game',
        completed: step4Complete,
        directionText: 'Tap + Schedule New Game (top of this screen). Pick your team, opponent, and date.',
      },
      {
        id: 5,
        title: 'Plan your rotations',
        completed: step5Complete,
        directionText: 'Tap 📋 Plan Game on your game card below. TeamTrack will auto-generate a fair rotation so every player gets equal time.',
      },
      {
        id: 6,
        title: 'Manage a live game',
        completed: step6Complete,
        directionText: 'On game day, open your game and tap Start Game. Use the Lineup tab for substitutions, the score tracker at the top, and Notes to flag standout plays or cards.',
      },
    ];

    const completedCount = steps.filter(s => s.completed).length;
    const allComplete = completedCount === steps.length;

    return { steps, completedCount, allComplete };
  }, [teams, games, teamRosters, gamePlans]);
}
