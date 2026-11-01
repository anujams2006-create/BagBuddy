import React from 'react';
import { Trip, PackingListResult, User } from '../types';
import { effectiveBaggageLimit, transportSummary, tripHasPlaneLeg } from '../lib/transport';

interface HomeProps {
  currentUser: User | null;
  currentTrip: Trip | null;
  currentPackingList: PackingListResult | null;
  onNavigate: (view: 'dashboard' | 'setup' | 'login' | 'signup') => void;
}

export const Home: React.FC<HomeProps> = ({
  currentUser,
  currentTrip,
  currentPackingList,
  onNavigate,
}) => {
  return (
    <main>
      <div className="hero-wrapper">
        <section className="home-hero">
          <div>
            <p className="eyebrow">PACK SMARTER · TRAVEL LIGHTER</p>
            <h1>Pack smarter.<br />Travel lighter.</h1>
            <p>Your personalized packing assistant for every journey. Plan your trip, tailor essentials, and keep your bag within limits before you leave.</p>
            
            <div className="hero-actions">
              {currentUser ? (
                <>
                  <button className="primary-btn" onClick={() => onNavigate('setup')}>
                    Plan my trip <span>→</span>
                  </button>
                  <button className="secondary-btn" onClick={() => onNavigate('dashboard')}>
                    View dashboard
                  </button>
                </>
              ) : (
                <>
                  <button className="primary-btn" onClick={() => onNavigate('signup')}>
                    Plan my trip <span>→</span>
                  </button>
                  <button className="secondary-btn" onClick={() => onNavigate('login')}>
                    Log in
                  </button>
                </>
              )}
            </div>
            
            <p className="hero-note">Built for vacations, family travel, road trips and hostel shifting.</p>
          </div>

          {/* Travel Plan Card */}
          <aside className="travel-plan-card" aria-label="Your Travel Plan">
            {currentTrip ? (
              <>
                <div className="plan-card-header">
                  <span className="plan-card-eyebrow">✈ YOUR UPCOMING TRIP</span>
                  <span className="plan-mode-badge">{transportSummary(currentTrip)}</span>
                </div>

                <div className="plan-destination-block">
                  <div className="plan-dest-info">
                    <span className="plan-dest-label">Destination</span>
                    <h2 className="plan-destination-title">📍 {currentTrip.destination}</h2>
                    <p className="plan-dates">🗓 {currentTrip.start_date} → {currentTrip.end_date}</p>
                  </div>
                  <div className="plan-dest-accent" aria-hidden="true">
                    <span>🧳</span>
                  </div>
                </div>

                <div className="plan-divider"></div>

                <div className="plan-specs-grid">
                  <div className="plan-spec-item">
                    <span className="spec-label">Travel Style</span>
                    <strong className="spec-value">{currentTrip.trip_type || currentTrip.travel_mode}</strong>
                  </div>
                  <div className="plan-spec-item">
                    <span className="spec-label">Bag Allowance</span>
                    <strong className="spec-value">
                      {effectiveBaggageLimit(currentTrip) != null
                        ? `${currentTrip.bag_type} (flight limit ${effectiveBaggageLimit(currentTrip)} kg)`
                        : tripHasPlaneLeg(currentTrip)
                          ? `${currentTrip.bag_type} (flight allowance not set)`
                          : currentTrip.bag_type}
                    </strong>
                  </div>
                </div>

                {currentPackingList && (
                  <div className="plan-progress-block">
                    <div className="progress-info">
                      <span className="progress-title">Packing Prepared</span>
                      <span className="progress-count">{currentPackingList.items.length} items</span>
                    </div>
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: '100%' }}></div>
                    </div>
                    <p className="progress-subtext">Estimated weight: {currentPackingList.total_weight} kg</p>
                  </div>
                )}

                <div className="plan-card-action">
                  <button
                    onClick={() => onNavigate('dashboard')}
                    className="primary-btn plan-cta-btn"
                  >
                    View Packing List <span>→</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="plan-card-header">
                  <span className="plan-card-eyebrow">✈ YOUR TRIP PREVIEW</span>
                  <span className="plan-mode-badge">Get Ready</span>
                </div>

                <div className="plan-destination-block">
                  <div className="plan-dest-info">
                    <span className="plan-dest-label">Where to next?</span>
                    <h2 className="plan-destination-title">Ready for your next trip?</h2>
                    <p className="plan-preview-desc">
                      Plan your journey and we'll help you build a personalized, weight-checked packing list.
                    </p>
                  </div>
                  <div className="plan-dest-accent" aria-hidden="true">
                    <span>✈️</span>
                  </div>
                </div>

                <div className="plan-divider"></div>

                <div className="plan-preview-highlights">
                  <div className="preview-item">
                    <span className="preview-icon">📍</span>
                    <div className="preview-text">
                      <strong>Smart Destinations</strong>
                      <small>Tailored to your climate &amp; activities</small>
                    </div>
                  </div>
                  <div className="preview-item">
                    <span className="preview-icon">🧳</span>
                    <div className="preview-text">
                      <strong>Bag Weight Limits</strong>
                      <small>Stay under airline &amp; transport fees</small>
                    </div>
                  </div>
                </div>

                <div className="plan-card-action">
                  <button
                    onClick={() => onNavigate(currentUser ? 'setup' : 'signup')}
                    className="primary-btn plan-cta-btn"
                  >
                    Plan My Trip <span>→</span>
                  </button>
                </div>
              </>
            )}
          </aside>
        </section>
      </div>

      {/* How It Works Section */}
      <section className="home-section">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2>Everything you need, nothing invented.</h2>
        <p>Make a few clear choices, then use a categorized list to prepare with confidence.</p>
        <div className="feature-grid">
          <article className="feature-card">
            <p className="feature-index">01</p>
            <h3>Plan the trip</h3>
            <p>Add your destination, dates, travel mode and planned activities.</p>
          </article>
          <article className="feature-card">
            <p className="feature-index">02</p>
            <h3>Choose preferences</h3>
            <p>See optional personal items that match your chosen profile, while common essentials stay in every list.</p>
          </article>
          <article className="feature-card">
            <p className="feature-index">03</p>
            <h3>Check your bag</h3>
            <p>Review categories, mark items packed and compare the estimated weight with your limit.</p>
          </article>
        </div>
      </section>
    </main>
  );
};
