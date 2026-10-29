import React from 'react';
import { User } from '../types';

interface HeaderProps {
  currentUser: User | null;
  activeView: string;
  setActiveView: (view: 'home' | 'dashboard' | 'setup' | 'trips' | 'login' | 'signup') => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeView,
  setActiveView,
  onLogout,
}) => {
  return (
    <header className="site-header">
      <button
        onClick={() => setActiveView('home')}
        className="brand"
        style={{ background: 'none', border: 'none', padding: 0 }}
      >
        <span aria-hidden="true">🎒</span> BagBuddy
      </button>

      <nav aria-label="Main navigation">
        {currentUser ? (
          <>
            <button
              onClick={() => setActiveView('dashboard')}
              className={`nav-link ${activeView === 'dashboard' ? 'active-link' : ''}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveView('trips')}
              className={`nav-link ${activeView === 'trips' ? 'active-link' : ''}`}
            >
              My trips
            </button>
            <button
              onClick={() => setActiveView('setup')}
              className={`nav-link ${activeView === 'setup' ? 'active-link' : ''}`}
            >
              Plan trip
            </button>
            <button
              onClick={onLogout}
              className="nav-link nav-quiet"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setActiveView('login')}
              className={`nav-link ${activeView === 'login' ? 'active-link' : ''}`}
            >
              Log in
            </button>
            <button
              onClick={() => setActiveView('signup')}
              className="primary-btn"
              style={{ minHeight: '36px', padding: '6px 14px', fontSize: '0.85rem' }}
            >
              Create account
            </button>
          </>
        )}
      </nav>
    </header>
  );
};
