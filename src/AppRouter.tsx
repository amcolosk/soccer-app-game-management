import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { FanGameView } from "./components/FanMode/FanGameView";
import { StatTrackerView } from "./components/FanMode/StatTrackerView";

// Lazy-loaded so the public /watch/:token and /track/:token routes never
// pull in the authenticated app shell's bundle (App.css, Authenticator,
// LandingPage, the amplify-ui stylesheet, etc. — see AppRoot.tsx). Same
// pattern already used for Management/UserProfile/SeasonReportRoute in
// App.tsx.
const AppRootLazy = lazy(() => import("./AppRoot"));

const loadingFallback = (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>
);

// Suspense here is required, not optional — AppRootLazy suspends on its
// first render while its chunk loads; with no Suspense ancestor, React
// throws "A component suspended while rendering, but no fallback UI was
// specified" on every cold load of the authenticated shell. The fallback
// matches the existing `authStatus === 'configuring'` "Loading..." state so
// there's no visible regression.
export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={loadingFallback}>
        <Routes>
          <Route path="/watch/:token" element={<FanGameView />} />
          <Route path="/track/:token" element={<StatTrackerView />} />
          <Route path="*" element={<AppRootLazy />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
