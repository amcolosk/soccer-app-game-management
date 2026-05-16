import { useParams, Navigate } from 'react-router-dom';

/**
 * Backward compatibility redirect for the old /game/:gameId/plan route.
 * Redirects to /game/:gameId which now includes the Plan tab.
 */
export function GamePlanRedirect() {
  const { gameId } = useParams<{ gameId: string }>();
  
  if (!gameId) {
    return <Navigate to="/" replace />;
  }
  
  return <Navigate to={`/game/${gameId}?tab=plan`} replace />;
}
