import { lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useSearchParams,
} from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Home } from "./components/Home";
import { GameManagementRoute } from "./components/routes/GameManagementRoute";
import { GamePlannerRoute } from "./components/routes/GamePlannerRoute";
import { InvitationRoute } from "./components/routes/InvitationRoute";
import "./App.css";

// Lazy-loaded routes (large components, only loaded when navigated to)
const Management = lazy(() =>
  import("./components/Management").then((m) => ({ default: m.Management }))
);
const UserProfile = lazy(() =>
  import("./components/UserProfile").then((m) => ({ default: m.UserProfile }))
);
const SeasonReportRoute = lazy(() =>
  import("./components/routes/SeasonReportRoute").then((m) => ({
    default: m.SeasonReportRoute,
  }))
);
const DevDashboardRoute = lazy(() =>
  import("./components/routes/DevDashboardRoute").then((m) => ({
    default: m.DevDashboardRoute,
  }))
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Invitation flow — full-screen, outside AppLayout */}
        <Route path="/invite/:invitationId" element={<InvitationRoute />} />

        {/* Developer dashboard — full-screen, outside AppLayout */}
        <Route path="/dev" element={<DevDashboardRoute />} />

        {/* Main app shell with bottom nav */}
        <Route element={<AppLayout />}>
          <Route index element={<HomeOrLegacyRedirect />} />
          <Route path="game/:gameId" element={<GameManagementRoute />} />
          <Route path="game/:gameId/plan" element={<GamePlannerRoute />} />
          <Route path="reports" element={<SeasonReportRoute />} />
          <Route path="reports/:teamId" element={<SeasonReportRoute />} />
          <Route path="manage" element={<Management />} />
          <Route path="profile" element={<UserProfile />} />
        </Route>

        {/* Catch-all redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Handles the legacy /?invitationId=xxx URL pattern by redirecting
 * to /invite/:invitationId. Otherwise renders Home.
 */
function HomeOrLegacyRedirect() {
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get("invitationId");

  if (invitationId) {
    return <Navigate to={`/invite/${invitationId}`} replace />;
  }

  return <Home />;
}

export default App;
