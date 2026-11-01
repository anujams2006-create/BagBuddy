import React, { useState } from 'react';
import { User } from '../types';
import { currentUser } from '../lib/data';
import { supabase } from '../lib/supabase';

interface AuthProps {
  mode: 'login' | 'signup';
  onSuccess: (user: User) => void;
  onSwitchMode: (mode: 'login' | 'signup') => void;
  onBack: () => void;
}

export const Auth: React.FC<AuthProps> = ({
  mode,
  onSuccess,
  onSwitchMode,
  onBack,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase().auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setSuccess('Account created. Check your email to confirm your account, then log in.');
          return;
        }
      } else {
        const { error: signInError } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
      }
      const user = await currentUser();
      if (!user) throw new Error('Your session could not be restored. Please try again.');
      setSuccess(mode === 'signup' ? 'Account created successfully!' : `Welcome back, ${user.name}!`);
      onSuccess(user);
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed. Please try again.');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-nav">
        <button onClick={onBack} className="back-link">
          ← Back to BagBuddy
        </button>
        <div className="brand">
          <span className="brand-icon">🎒</span>
          BagBuddy
        </div>
      </div>

      <div className="auth-card-container">
        {/* Left: Travel Visual Side */}
        <div className="auth-travel-panel">
          <div className="travel-panel-header">
            <div className="travel-badge">
              <span>🍊</span> {mode === 'login' ? 'Vacation Ready' : 'Start Your Journey'}
            </div>
            <h2 className="travel-panel-title">
              {mode === 'login' ? (
                <>Pack smarter.<br />Travel lighter.</>
              ) : (
                <>Never leave an<br />essential behind.</>
              )}
            </h2>
            <p className="travel-panel-subtitle">
              {mode === 'login'
                ? 'Turn your destination and travel plans into a practical packing list you can rely on.'
                : 'Join BagBuddy to build personalized packing lists, track luggage weight, and travel stress-free.'}
            </p>

            <ul className="travel-perks">
              <li>
                <span className="perk-icon">✈️</span>
                <span>Personalized essentials for every trip</span>
              </li>
              <li>
                <span className="perk-icon">🧳</span>
                <span>Luggage weight tracking against bag limits</span>
              </li>
              <li>
                <span className="perk-icon">🌴</span>
                <span>Tailored for vacations, road trips &amp; hostels</span>
              </li>
            </ul>
          </div>

          <div className="travel-panel-footer">
            <span>{mode === 'login' ? 'Ready for your next getaway?' : 'Join thousands of smart travelers'}</span>
            <strong>BagBuddy</strong>
          </div>
        </div>

        {/* Right: Auth Form Side */}
        <div className="auth-form-panel">
          <div className="auth-header">
            <span className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span>
            <h1>{mode === 'login' ? 'Log in to BagBuddy' : 'Create your account'}</h1>
            <p className="auth-subtitle">
              {mode === 'login'
                ? 'Plan your next trip and keep your bag ready.'
                : 'Start planning smarter trips with BagBuddy.'}
            </p>
          </div>

          {error && (
            <div className="flash error">
              ⚠️ {error}
            </div>
          )}

          {success && (
            <div className="flash success">
              ✓ {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            {mode === 'signup' && (
              <div className="form-group">
                <label htmlFor="name">Full Name</label>
                <input
                  type="text"
                  id="name"
                  className="auth-input"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                className="auth-input"
                placeholder="Enter your email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                className="auth-input"
                placeholder={mode === 'signup' ? 'Create a password' : 'Enter your password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="auth-button">
              {mode === 'login' ? 'Login' : 'Create Account'} <span>→</span>
            </button>
          </form>

          <p className="auth-footer">
            {mode === 'login' ? (
              <>
                Don't have an account?
                <button type="button" onClick={() => onSwitchMode('signup')}>
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?
                <button type="button" onClick={() => onSwitchMode('login')}>
                  Log in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
