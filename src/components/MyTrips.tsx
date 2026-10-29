import React from 'react';
import { Trip, PackingListResult } from '../types';
import { deleteTrip, setCurrentTrip, setCurrentPackingList } from '../storage';
import { generatePackingList } from '../packingEngine';

interface MyTripsProps {
  trips: Trip[];
  onSelectTrip: (trip: Trip, list: PackingListResult) => void;
  onNavigate: (view: 'setup') => void;
  onRefreshTrips: () => void;
}

export const MyTrips: React.FC<MyTripsProps> = ({
  trips,
  onSelectTrip,
  onNavigate,
  onRefreshTrips,
}) => {
  const handleViewChecklist = (trip: Trip) => {
    const packingList = generatePackingList(trip);
    setCurrentTrip(trip);
    setCurrentPackingList(packingList);
    onSelectTrip(trip, packingList);
  };

  const handleDelete = (trip: Trip) => {
    if (window.confirm(`Are you sure you want to delete your trip to ${trip.destination}?`)) {
      if (trip.id) {
        deleteTrip(trip.id);
        onRefreshTrips();
      }
    }
  };

  return (
    <main className="my-trips-container">
      <section className="trips-page-header">
        <div>
          <p className="welcome-badge">SAVED ITINERARIES</p>
          <h1>My Trips</h1>
          <p>All your upcoming and past packing plans, stored securely.</p>
        </div>
        <button onClick={() => onNavigate('setup')} className="new-trip-btn">
          Plan a new trip <span>+</span>
        </button>
      </section>

      {trips && trips.length > 0 ? (
        <div className="trips-grid">
          {trips.map(t => (
            <article key={t.id} className="trip-card">
              <div className="trip-card-header">
                <span className="trip-mode-pill">✈ {t.travel_mode}</span>
                <span className="trip-type-pill">{t.trip_type || 'Personal'}</span>
              </div>

              <h2 className="trip-card-dest">📍 {t.destination}</h2>
              <p className="trip-card-dates">🗓 {t.start_date} → {t.end_date}</p>

              <div className="trip-card-specs">
                <div className="spec-unit">
                  <span>Bag allowance</span>
                  <strong>{t.bag_type} ({t.weight_limit} kg)</strong>
                </div>
                <div className="spec-unit">
                  <span>Travelers</span>
                  <strong>
                    {t.adults} Adult{t.children && t.children > 0 ? `, ${t.children} Child` : ''}
                  </strong>
                </div>
              </div>

              <div className="trip-card-footer">
                <button
                  onClick={() => handleViewChecklist(t)}
                  className="primary-btn"
                >
                  View Checklist <span>→</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  className="delete-btn"
                  title="Delete this trip"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-trips-card">
          <span className="empty-icon" aria-hidden="true">🧳</span>
          <h2>No saved trips yet</h2>
          <p>Ready for your next getaway? Plan your journey and BagBuddy will prepare a customized packing checklist.</p>
          <button onClick={() => onNavigate('setup')} className="primary-btn">
            Plan My First Trip <span>→</span>
          </button>
        </section>
      )}
    </main>
  );
};
