import { Suspense } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { Toaster } from "react-hot-toast";
import { ConfirmProvider } from "./ConfirmModal";
import { useEffect } from "react";
import { trackPageView } from "../utils/analytics";

export function AppLayout() {
  const location = useLocation();
  const { signOut } = useAuthenticator();

  // Track page views on every route change
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  return (
    <ConfirmProvider>
      <main className="app-container">
        <Toaster
          position="top-center"
          toastOptions={{
            style: { fontSize: "0.95rem", maxWidth: "90vw" },
            success: { duration: 2500 },
            error: { duration: 4000 },
          }}
        />
        <header className="app-header">
          <div className="app-branding">
            <h1>⚽ TeamTrack</h1>
            <p className="app-tagline">Game Management for Coaches</p>
          </div>
        </header>

        <Suspense
          fallback={
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <p>Loading...</p>
            </div>
          }
        >
          <Outlet context={{ signOut }} />
        </Suspense>

        <nav className="bottom-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `nav-item ${isActive ? "active" : ""}`
            }
            aria-label="Games"
          >
            <span className="nav-icon">⚽</span>
            <span className="nav-label">Games</span>
          </NavLink>
          <NavLink
            to="/reports"
            className={() =>
              `nav-item ${location.pathname.startsWith("/reports") ? "active" : ""}`
            }
            aria-label="Reports"
          >
            <span className="nav-icon">📊</span>
            <span className="nav-label">Reports</span>
          </NavLink>
          <NavLink
            to="/manage"
            className={({ isActive }) =>
              `nav-item ${isActive ? "active" : ""}`
            }
            aria-label="Manage"
          >
            <span className="nav-icon">⚙️</span>
            <span className="nav-label">Manage</span>
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `nav-item ${isActive ? "active" : ""}`
            }
            aria-label="Profile"
          >
            <span className="nav-icon">👤</span>
            <span className="nav-label">Profile</span>
          </NavLink>
        </nav>
      </main>
    </ConfirmProvider>
  );
}
