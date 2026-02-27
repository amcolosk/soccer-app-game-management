import { Navigate } from 'react-router-dom';
import { useDeveloperAccess } from '../../hooks/useDeveloperAccess';
import { DevDashboard } from '../DevDashboard/DevDashboard';

export function DevDashboardRoute() {
  const { checking, isDeveloper, userEmail } = useDeveloperAccess();

  if (checking) {
    return (
      <div className="dev-access-loading">
        <div className="dev-spinner">
          <span className="dev-spinner-dot" />
          <span className="dev-spinner-dot" />
          <span className="dev-spinner-dot" />
        </div>
        <p className="dev-access-loading-text">Checking access...</p>
      </div>
    );
  }

  if (!isDeveloper) {
    return <Navigate to="/" replace />;
  }

  return <DevDashboard userEmail={userEmail ?? ''} />;
}
