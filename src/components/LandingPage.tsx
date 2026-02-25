import React from 'react';
import { trackEvent } from '../utils/analytics';

interface LandingPageProps {
  onLogin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLogin }) => {
  const handleGetStarted = () => {
    trackEvent('Landing', 'Click Get Started');
    onLogin();
  };

  const handleLogin = () => {
    trackEvent('Landing', 'Click Log In');
    onLogin();
  };

  return (
    <div className="landing-page">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="landing-header">
        <div className="landing-logo">
          <span className="landing-logo-mark">⚽</span>
          <span className="landing-logo-name">TeamTrack</span>
          <span className="beta-badge">BETA</span>
        </div>
        <button className="landing-login-btn" onClick={handleLogin}>Log In</button>
      </header>

      <main>

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="landing-hero">
          <div className="landing-hero-content">
            <div className="hero-eyebrow">Free during beta</div>
            <h1>Fair play time for every player, every game.</h1>
            <p className="landing-tagline">
              TeamTrack helps youth soccer coaches manage rotations, track substitutions,
              and make sure every player gets the time they deserve — right from the sideline.
            </p>
            <div className="hero-cta-group">
              <button className="cta-primary" onClick={handleGetStarted}>
                Get Started Free
              </button>
              <button className="cta-secondary" onClick={handleLogin}>
                Log In
              </button>
            </div>
            <p className="beta-disclaimer">
              TeamTrack is in active beta. Features are evolving and your feedback shapes what we build next.
            </p>
          </div>
          <div className="hero-screenshot">
            <img
              src="/img/game-management.png"
              alt="TeamTrack live game management screen showing score, rotation timer, and game clock"
              className="hero-screenshot-img"
            />
          </div>
        </section>

        {/* ── Feature highlights ─────────────────────────────────────────── */}
        <section className="landing-features">
          <h2>Everything you need on game day</h2>
          <div className="feature-grid">

            <div className="feature-card">
              <div className="feature-icon">📋</div>
              <h3>Rotation Planning</h3>
              <p>
                Build your pre-game rotation before kickoff. The auto-planner generates
                balanced rotations based on who's available and preferred positions.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">⏱️</div>
              <h3>Live Play Time Tracking</h3>
              <p>
                Every substitution automatically records start and end times. See at a
                glance who's been on the field and who's waiting for their turn.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🔄</div>
              <h3>Smooth Substitutions</h3>
              <p>
                Tap a position to substitute. Player play time is visible right in the
                sub screen so you always pick fairly.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📊</div>
              <h3>Season Reports</h3>
              <p>
                After the season, see exactly how many minutes each player spent in each
                position. Spot imbalances and adjust for next year.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">👥</div>
              <h3>Multi-Coach Teams</h3>
              <p>
                Share your team with an assistant coach. Invite them by email and they
                get full access to manage games alongside you.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📱</div>
              <h3>Works on Any Device</h3>
              <p>
                Install it like an app on your phone or tablet. Works from the sideline
                even with a weak signal.
              </p>
            </div>

          </div>
        </section>

        {/* ── Screenshots ────────────────────────────────────────────────── */}
        <section className="landing-screenshots">
          <h2>See it in action</h2>
          <div className="screenshot-grid">
            <div className="screenshot-item">
              <img src="/img/upcoming-games.png" alt="Upcoming games list with Schedule New Game button" className="screenshot-img" />
              <p className="screenshot-caption">Schedule games and track your season</p>
            </div>
            <div className="screenshot-item">
              <img src="/img/game-management.png" alt="Live game management with score, goal buttons, and rotation timer" className="screenshot-img" />
              <p className="screenshot-caption">Live game management with rotation reminders</p>
            </div>
            <div className="screenshot-item">
              <img src="/img/game-planner.png" alt="Game plan screen with rotation timeline and lineup builder" className="screenshot-img" />
              <p className="screenshot-caption">Auto-generate rotations before kickoff</p>
            </div>
            <div className="screenshot-item">
              <img src="/img/player-time-tracking.png" alt="Available players list showing time played for each player" className="screenshot-img" />
              <p className="screenshot-caption">See every player's time before making a sub</p>
            </div>
            <div className="screenshot-item">
              <img src="/img/season-report.png" alt="Season report with win-loss record and play time table" className="screenshot-img" />
              <p className="screenshot-caption">Season summary with play time per player</p>
            </div>
            <div className="screenshot-item">
              <img src="/img/season-report-player.png" alt="Individual player detail showing play time by position, goals, and gold stars" className="screenshot-img" />
              <p className="screenshot-caption">Drill into each player's positions and highlights</p>
            </div>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────────── */}
        <section className="landing-how-it-works">
          <h2>Up and running in minutes</h2>
          <ol className="steps-list">
            <li>
              <span className="step-number">1</span>
              <div>
                <strong>Create your team</strong>
                <p>Set up your roster, formation, and field size. Add players with jersey numbers.</p>
              </div>
            </li>
            <li>
              <span className="step-number">2</span>
              <div>
                <strong>Plan the game</strong>
                <p>Mark who's available, then let the auto-planner build your rotation schedule.</p>
              </div>
            </li>
            <li>
              <span className="step-number">3</span>
              <div>
                <strong>Run the game</strong>
                <p>Start the timer, follow your rotation plan, and make subs with a tap.</p>
              </div>
            </li>
            <li>
              <span className="step-number">4</span>
              <div>
                <strong>Review the season</strong>
                <p>Open the season report to see how playing time was distributed across every player.</p>
              </div>
            </li>
          </ol>
        </section>

        {/* ── Beta CTA ───────────────────────────────────────────────────── */}
        <section className="landing-cta-section">
          <div className="cta-card">
            <span className="beta-badge-large">BETA</span>
            <h2>Try TeamTrack free during beta</h2>
            <p>
              No credit card needed. We're actively developing TeamTrack and
              would love your feedback.
            </p>
            <button className="cta-primary cta-large" onClick={handleGetStarted}>
              Create Free Account
            </button>
          </div>
        </section>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <p>
          <strong>TeamTrack</strong> &mdash; Game management for coaches &nbsp;|&nbsp;
          <a href="https://coachteamtrack.com" style={{ color: 'inherit' }}>coachteamtrack.com</a>
        </p>
        <p className="footer-beta-note">
          Currently in beta. Expect updates, new features, and occasional rough edges.
        </p>
        <p>&copy; {new Date().getFullYear()} TeamTrack. All rights reserved.</p>
      </footer>

      <style>{`
        /* ── Base ──────────────────────────────────────────────────────── */
        .landing-page {
          min-height: 100vh;
          background: var(--background);
          display: flex;
          flex-direction: column;
          font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
        }

        /* ── Header ────────────────────────────────────────────────────── */
        .landing-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.08);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .landing-logo {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .landing-logo-mark {
          font-size: 1.5rem;
        }

        .landing-logo-name {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--primary-green);
        }

        .beta-badge {
          background: #f59e0b;
          color: white;
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          vertical-align: middle;
        }

        .beta-badge-large {
          display: inline-block;
          background: #f59e0b;
          color: white;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          margin-bottom: 1rem;
        }

        .landing-login-btn {
          background: transparent;
          border: 2px solid var(--primary-green);
          color: var(--primary-green);
          padding: 0.5rem 1.5rem;
          border-radius: 20px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
          font-size: 0.95rem;
        }

        .landing-login-btn:hover {
          background: var(--primary-green);
          color: white;
        }

        /* ── Hero ──────────────────────────────────────────────────────── */
        .landing-hero {
          display: flex;
          align-items: center;
          gap: 3rem;
          padding: 4rem 2rem;
          background: linear-gradient(135deg, var(--primary-green) 0%, var(--light-green) 100%);
          color: white;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
          box-sizing: border-box;
        }

        /* Full-width green background behind hero */
        .landing-hero {
          max-width: 100%;
        }

        .landing-hero-content {
          flex: 1;
          max-width: 600px;
          margin: 0 auto;
        }

        .hero-eyebrow {
          font-size: 0.85rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          opacity: 0.8;
          margin-bottom: 0.75rem;
        }

        .landing-hero h1 {
          font-size: 2.75rem;
          line-height: 1.15;
          margin-bottom: 1.25rem;
          font-weight: 800;
        }

        .landing-tagline {
          font-size: 1.15rem;
          line-height: 1.6;
          opacity: 0.9;
          margin-bottom: 2rem;
        }

        .hero-cta-group {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
          margin-bottom: 1.25rem;
        }

        .cta-primary {
          background: var(--accent-green);
          color: white;
          border: none;
          padding: 0.9rem 2rem;
          font-size: 1.05rem;
          border-radius: 30px;
          cursor: pointer;
          font-weight: 700;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .cta-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.3);
          background: #43a047;
        }

        .cta-secondary {
          background: rgba(255,255,255,0.15);
          color: white;
          border: 2px solid rgba(255,255,255,0.5);
          padding: 0.9rem 2rem;
          font-size: 1.05rem;
          border-radius: 30px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }

        .cta-secondary:hover {
          background: rgba(255,255,255,0.25);
          border-color: white;
        }

        .cta-large {
          padding: 1rem 2.5rem;
          font-size: 1.1rem;
        }

        .beta-disclaimer {
          font-size: 0.85rem;
          opacity: 0.75;
          margin: 0;
        }

        .hero-screenshot {
          flex: 0 0 220px;
          max-width: 220px;
        }

        .hero-screenshot-img {
          width: 100%;
          border-radius: 28px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
          display: block;
        }

        /* ── Features ──────────────────────────────────────────────────── */
        .landing-features {
          padding: 5rem 2rem;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
          box-sizing: border-box;
          text-align: center;
        }

        .landing-features h2 {
          font-size: 2rem;
          color: var(--primary-green);
          margin-bottom: 3rem;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
          text-align: left;
        }

        .feature-card {
          background: white;
          padding: 2rem;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          border: 1px solid var(--border-color);
        }

        .feature-icon {
          font-size: 2.25rem;
          margin-bottom: 0.75rem;
        }

        .feature-card h3 {
          font-size: 1.1rem;
          color: var(--primary-green);
          margin-bottom: 0.5rem;
        }

        .feature-card p {
          color: var(--text-secondary);
          line-height: 1.6;
          margin: 0;
          font-size: 0.95rem;
        }

        /* ── Screenshots ───────────────────────────────────────────────── */
        .landing-screenshots {
          background: white;
          padding: 5rem 2rem;
          text-align: center;
        }

        .landing-screenshots h2 {
          font-size: 2rem;
          color: var(--primary-green);
          margin-bottom: 3rem;
        }

        .screenshot-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem 1.5rem;
          max-width: 860px;
          margin: 0 auto;
        }

        .screenshot-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .screenshot-img {
          width: 100%;
          border-radius: 20px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12);
          display: block;
        }

        .screenshot-caption {
          margin: 0.75rem 0 0;
          font-size: 0.85rem;
          color: var(--text-secondary);
          text-align: center;
          line-height: 1.4;
        }

        /* ── How it works ──────────────────────────────────────────────── */
        .landing-how-it-works {
          padding: 5rem 2rem;
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
          box-sizing: border-box;
          text-align: center;
        }

        .landing-how-it-works h2 {
          font-size: 2rem;
          color: var(--primary-green);
          margin-bottom: 3rem;
        }

        .steps-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          text-align: left;
        }

        .steps-list li {
          display: flex;
          gap: 1.25rem;
          align-items: flex-start;
        }

        .step-number {
          flex-shrink: 0;
          width: 2.25rem;
          height: 2.25rem;
          background: var(--primary-green);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 1rem;
          margin-top: 0.1rem;
        }

        .steps-list li div strong {
          display: block;
          font-size: 1.05rem;
          color: var(--text-primary);
          margin-bottom: 0.25rem;
        }

        .steps-list li div p {
          margin: 0;
          color: var(--text-secondary);
          line-height: 1.6;
          font-size: 0.95rem;
        }

        /* ── Beta CTA section ──────────────────────────────────────────── */
        .landing-cta-section {
          background: linear-gradient(135deg, var(--primary-green) 0%, var(--light-green) 100%);
          padding: 5rem 2rem;
          text-align: center;
        }

        .cta-card {
          max-width: 600px;
          margin: 0 auto;
          color: white;
        }

        .cta-card h2 {
          font-size: 2rem;
          margin-bottom: 1rem;
        }

        .cta-card p {
          font-size: 1.1rem;
          opacity: 0.9;
          margin-bottom: 2rem;
          line-height: 1.6;
        }

        /* ── Footer ────────────────────────────────────────────────────── */
        .landing-footer {
          text-align: center;
          padding: 2.5rem 2rem;
          background: #1a1a1a;
          color: #aaa;
          font-size: 0.9rem;
          line-height: 1.8;
          margin-top: auto;
        }

        .landing-footer strong {
          color: #ddd;
        }

        .footer-beta-note {
          color: #f59e0b;
          font-size: 0.85rem;
        }

        /* ── Responsive ────────────────────────────────────────────────── */
        @media (max-width: 900px) {
          .landing-hero {
            flex-direction: column;
            padding: 3rem 1.5rem;
          }

          .hero-screenshot {
            flex: none;
            max-width: 200px;
            align-self: center;
          }

          .landing-hero-content {
            text-align: center;
          }

          .hero-cta-group {
            justify-content: center;
          }

          .screenshot-grid {
            grid-template-columns: repeat(2, 1fr);
            max-width: 520px;
          }
        }

        @media (max-width: 600px) {
          .landing-hero h1 {
            font-size: 2rem;
          }

          .landing-features h2,
          .landing-screenshots h2,
          .landing-how-it-works h2,
          .cta-card h2 {
            font-size: 1.6rem;
          }

          .landing-header {
            padding: 0.75rem 1rem;
          }

          .hero-screenshot {
            display: none;
          }

          .screenshot-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
          }
        }
      `}</style>
    </div>
  );
};
