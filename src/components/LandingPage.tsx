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

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="logo">⚽ TeamTrack</div>
        <button className="login-btn" onClick={onLogin}>Log In</button>
      </header>

      <main>
        <section className="hero">
          <h1>Manage Your Soccer Team Like a Pro</h1>
          <p className="tagline">
            Track playing time, manage substitutions, and organize your roster—all from the sideline.
          </p>
          <button className="cta-button" onClick={handleGetStarted}>
            Get Started for Free
          </button>
        </section>

        <section className="features">
          <div className="feature-card">
            <div className="icon">⏱️</div>
            <h3>Fair Play Tracking</h3>
            <p>Automatically track playing time for every player to ensure fair distribution.</p>
          </div>
          
          <div className="feature-card">
            <div className="icon">📋</div>
            <h3>Easy Substitutions</h3>
            <p>Drag-and-drop interface to manage lineups and substitutions during the game.</p>
          </div>

          <div className="feature-card">
            <div className="icon">📊</div>
            <h3>Season Stats</h3>
            <p>View comprehensive reports on player positions, game time, and team performance.</p>
          </div>
        </section>

        <section className="how-it-works">
          <h2>How It Works</h2>
          <ol>
            <li><strong>Create Your Team</strong> - Add players and set up your roster.</li>
            <li><strong>Start a Game</strong> - Track the game clock and positions in real-time.</li>
            <li><strong>Analyze Results</strong> - Get instant insights into playing time and stats.</li>
          </ol>
        </section>
      </main>

      <footer className="landing-footer">
        <p>&copy; {new Date().getFullYear()} TeamTrack. All rights reserved.</p>
      </footer>

      <style>{`
        .landing-page {
          min-height: 100vh;
          background: var(--background);
          display: flex;
          flex-direction: column;
        }

        .landing-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .logo {
          font-size: 1.5rem;
          font-weight: bold;
          color: var(--primary-green);
        }

        .login-btn {
          background: transparent;
          border: 2px solid var(--primary-green);
          color: var(--primary-green);
          padding: 0.5rem 1.5rem;
          border-radius: 20px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }

        .login-btn:hover {
          background: var(--primary-green);
          color: white;
        }

        .hero {
          text-align: center;
          padding: 4rem 2rem;
          background: linear-gradient(135deg, var(--primary-green) 0%, var(--light-green) 100%);
          color: white;
        }

        .hero h1 {
          font-size: 2.5rem;
          margin-bottom: 1rem;
        }

        .tagline {
          font-size: 1.2rem;
          margin-bottom: 2rem;
          opacity: 0.9;
          max-width: 600px;
          margin-left: auto;
          margin-right: auto;
        }

        .cta-button {
          background: var(--accent-green);
          color: white;
          border: none;
          padding: 1rem 2rem;
          font-size: 1.2rem;
          border-radius: 30px;
          cursor: pointer;
          font-weight: bold;
          box-shadow: 0 4px 6px rgba(0,0,0,0.2);
          transition: transform 0.2s;
        }

        .cta-button:hover {
          transform: translateY(-2px);
          background: #43a047;
        }

        .features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 2rem;
          padding: 4rem 2rem;
          max-width: 1200px;
          margin: 0 auto;
        }

        .feature-card {
          background: white;
          padding: 2rem;
          border-radius: 12px;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }

        .feature-card .icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .how-it-works {
          background: white;
          padding: 4rem 2rem;
          text-align: center;
        }

        .how-it-works ol {
          text-align: left;
          max-width: 600px;
          margin: 2rem auto;
          padding-left: 2rem;
        }

        .how-it-works li {
          margin-bottom: 1rem;
          font-size: 1.1rem;
        }

        .landing-footer {
          text-align: center;
          padding: 2rem;
          background: #333;
          color: #aaa;
          margin-top: auto;
        }

        @media (max-width: 768px) {
          .hero h1 {
            font-size: 2rem;
          }
        }
      `}</style>
    </div>
  );
};
