import React, { useState } from 'react';
import { Trip, PackingListResult } from '../types';
import { generatePackingList } from '../packingEngine';
import { PlaceAutocomplete } from './PlaceAutocomplete';
import type { PlaceResult } from '../lib/weather';
import { TransportLegsEditor } from './TransportLegsEditor';
import type { TransportLeg } from '../types';
import {
  createTransportLeg,
  legacyTravelModeValue,
  planeLegs,
  validateTransportLegs,
} from '../lib/transport';

interface TripSetupProps {
  onTripCreated: (trip: Trip, list: PackingListResult) => Promise<void>;
  onCancel?: () => void;
}

const PROFILE_OPTIONS: Record<string, string[]> = {
  Female: ['Skincare', 'Makeup', 'Hair care', 'Sanitary essentials', 'Jewelry', 'Hair accessories', 'Handbag', 'Scarf / Stole'],
  Male: ['Shaving kit', 'Beard care', 'Skincare', 'Hair care', 'Belt', 'Wallet', 'Watch', 'Cap'],
  Other: [],
};

const ALL_ACTIVITIES = [
  { value: 'Swimming', icon: '🏊' },
  { value: 'Hiking', icon: '🥾' },
  { value: 'Gym', icon: '◌' },
  { value: 'Beach', icon: '☀' },
  { value: 'Party', icon: '✦' },
  { value: 'Photography', icon: '⌁' },
  { value: 'Sightseeing', icon: '⌂' },
];

const HOSTEL_ITEMS = ['Bedsheet', 'Pillow', 'Blanket', 'Bucket', 'Study Materials', 'Laptop', 'Lock', 'Hangers', 'Water Bottle'];

const TOILETRIES_OPTIONS = ['Toothbrush', 'Toothpaste', 'Soap', 'Shampoo', 'Deodorant', 'Sunscreen', 'Medicines'];

export const TripSetup: React.FC<TripSetupProps> = ({ onTripCreated }) => {
  // Form fields
  // The destination is a real place picked from Open-Meteo suggestions; its
  // display name, coordinates, and timezone are all saved with the trip.
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // The journey is a list of transport legs (car, plane, bus, …), not one mode.
  const [legs, setLegs] = useState<TransportLeg[]>([createTransportLeg({ transport_type: 'Plane' })]);
  const [legErrors, setLegErrors] = useState<string[]>([]);
  const [tripType, setTripType] = useState('Vacation');
  const [profile, setProfile] = useState('Female');
  const [adults, setAdults] = useState(1);
  const [hasChildren, setHasChildren] = useState(false);
  const [children, setChildren] = useState(0);
  const [childAge, setChildAge] = useState('');
  const [activities, setActivities] = useState<string[]>(['Sightseeing', 'Beach']);
  const [shiftingItems, setShiftingItems] = useState<string[]>([]);
  const [personalization, setPersonalization] = useState<string[]>(['Skincare', 'Sunscreen']);
  const [bagType, setBagType] = useState('Cabin Bag');
  const [toiletries, setToiletries] = useState<string[]>(['Toothbrush', 'Toothpaste', 'Soap', 'Sunscreen']);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isHostel = legs.some(leg => leg.transport_type === 'Hostel');
  const flightLegs = planeLegs(legs);
  const flightAllowances = flightLegs
    .map(leg => leg.baggage_allowance_kg)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  // The enforced limit is the smallest flight allowance; null = no limit.
  const effectiveLimit = flightAllowances.length ? Math.min(...flightAllowances) : null;

  // When a destination place is picked, pre-fill the last leg's destination
  // if it is still blank (the user can always edit it).
  const handlePlaceChange = (place: PlaceResult | null) => {
    setSelectedPlace(place);
    if (place) {
      setLegs(prev => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (last.destination.trim()) return prev;
        return [...prev.slice(0, -1), { ...last, destination: place.name }];
      });
    }
  };

  const handleProfileChange = (newProfile: string) => {
    setProfile(newProfile);
    const available = PROFILE_OPTIONS[newProfile] || [];
    setPersonalization(personalization.filter(p => available.includes(p)));
  };

  const toggleActivity = (val: string) => {
    setActivities(prev =>
      prev.includes(val) ? prev.filter(a => a !== val) : [...prev, val]
    );
  };

  const toggleSelectAllActivities = () => {
    if (activities.length === ALL_ACTIVITIES.length) {
      setActivities([]);
    } else {
      setActivities(ALL_ACTIVITIES.map(a => a.value));
    }
  };

  const toggleHostelItem = (val: string) => {
    setShiftingItems(prev =>
      prev.includes(val) ? prev.filter(i => i !== val) : [...prev, val]
    );
  };

  const toggleSelectAllHostel = () => {
    if (shiftingItems.length === HOSTEL_ITEMS.length) {
      setShiftingItems([]);
    } else {
      setShiftingItems([...HOSTEL_ITEMS]);
    }
  };

  const togglePersonalization = (val: string) => {
    setPersonalization(prev =>
      prev.includes(val) ? prev.filter(p => p !== val) : [...prev, val]
    );
  };

  const toggleSelectAllPersonalization = () => {
    const choices = PROFILE_OPTIONS[profile] || [];
    if (personalization.length === choices.length) {
      setPersonalization([]);
    } else {
      setPersonalization([...choices]);
    }
  };

  const toggleToiletry = (val: string) => {
    setToiletries(prev =>
      prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val]
    );
  };

  const toggleSelectAllToiletries = () => {
    if (toiletries.length === TOILETRIES_OPTIONS.length) {
      setToiletries([]);
    } else {
      setToiletries([...TOILETRIES_OPTIONS]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!selectedPlace) {
      newErrors.destination = 'Please select a place from the suggestions so we can fetch accurate weather for it.';
    }
    if (!startDate) {
      newErrors.startDate = 'Please provide departure date.';
    }
    if (!endDate) {
      newErrors.endDate = 'Please provide return date.';
    }
    if (startDate && endDate && endDate < startDate) {
      newErrors.endDate = 'Return must be on or after departure.';
    }
    const foundLegErrors = validateTransportLegs(legs);
    setLegErrors(foundLegErrors);
    if (foundLegErrors.length > 0) {
      newErrors.legs = foundLegErrors[0];
    }
    if (!isHostel && !tripType) {
      newErrors.tripType = 'Please choose a trip type.';
    }
    if (!profile) {
      newErrors.profile = 'Please choose a packing profile.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    // Validation above guarantees a place was selected.
    const place = selectedPlace as PlaceResult;

    const tripData: Trip = {
      destination: place.displayName,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone ?? null,
      start_date: startDate,
      end_date: endDate,
      travel_mode: legacyTravelModeValue(legs),
      transport_legs: legs,
      trip_type: isHostel ? '' : tripType,
      profile,
      adults: Number(adults) || 1,
      children: hasChildren ? Number(children) || 0 : 0,
      child_age: hasChildren ? childAge : '',
      bag_type: bagType,
      // Only plane legs carry a baggage limit (see leg editor); null = none.
      weight_limit: effectiveLimit,
      activities: isHostel ? [] : activities,
      personalization,
      toiletries,
      shifting_items: isHostel ? shiftingItems : [],
    };

    const packingList = generatePackingList(tripData);
    try {
      await onTripCreated(tripData, packingList);
      setIsSubmitting(false);
    } catch (error: unknown) {
      setIsSubmitting(false);
      setErrors({ submit: error instanceof Error ? error.message : 'Could not save your trip.' });
    }
  };

  return (
    <main className="trip-page">
      <header className="page-intro">
        <p className="eyebrow">PLAN YOUR ESCAPE</p>
        <h1>Where will your next story take you?</h1>
        <p>Start with the essentials, choose your travel style, and leave with a packing list that feels ready for the journey.</p>
      </header>

      <form onSubmit={handleSubmit} noValidate>
        {errors.submit && <p className="field-error">{errors.submit}</p>}
        {/* Section 01: Destination & Dates */}
        <section className="trip-section">
          <div className="section-heading">
            <span>01</span>
            <div>
              <h2>Where are you going?</h2>
              <p>Set the destination and dates for your adventure.</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group full-width destination-group">
              <label htmlFor="destination">Destination <b aria-hidden="true">*</b></label>
              <PlaceAutocomplete
                id="destination"
                selectedPlace={selectedPlace}
                onChange={handlePlaceChange}
                hasError={!!errors.destination}
              />
              <small className="field-error">{errors.destination}</small>
            </div>

            <div className="form-group">
              <label htmlFor="start_date">Departure <b aria-hidden="true">*</b></label>
              <input
                id="start_date"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                aria-invalid={!!errors.startDate}
              />
              <small className="field-error">{errors.startDate}</small>
            </div>

            <div className="form-group">
              <label htmlFor="end_date">Return <b aria-hidden="true">*</b></label>
              <input
                id="end_date"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                aria-invalid={!!errors.endDate}
              />
              <small className="field-error">{errors.endDate}</small>
            </div>
          </div>
        </section>

        {/* Section 02: Journey legs */}
        <section className="trip-section">
          <div className="section-heading">
            <span>02</span>
            <div>
              <h2>How are you travelling?</h2>
              <p>Add each part of your journey — you can mix transport, like a car to the airport, a flight, then a bus.</p>
            </div>
          </div>

          <TransportLegsEditor legs={legs} onChange={setLegs} />
          {legErrors.map(error => (
            <small key={error} className="field-error" style={{ display: 'block' }}>{error}</small>
          ))}
        </section>

        {/* Section 03: Trip Type (Hidden if Hostel) */}
        {!isHostel && (
          <section className="trip-section">
            <div className="section-heading">
              <span>03</span>
              <div>
                <h2>What kind of trip is it?</h2>
                <p>We’ll tailor practical extras around your plans.</p>
              </div>
            </div>

            <fieldset className="selection-grid trip-type-grid">
              <legend className="sr-only">Trip type</legend>
              {[
                { value: 'Vacation', icon: '☀', title: 'Vacation' },
                { value: 'Business', icon: '◼', title: 'Business' },
                { value: 'Adventure', icon: '⛰', title: 'Adventure' },
                { value: 'College', icon: '◆', title: 'College trip' },
                { value: 'Family Visit', icon: '⌂', title: 'Family visit' },
                { value: 'Religious', icon: '✦', title: 'Religious' },
                { value: 'Other', icon: '…', title: 'Other' },
              ].map(t => (
                <label
                  key={t.value}
                  className={`selection-card compact-card ${tripType === t.value ? 'selected' : ''}`}
                  onClick={() => setTripType(t.value)}
                >
                  <input
                    type="radio"
                    name="trip_type"
                    value={t.value}
                    checked={tripType === t.value}
                    onChange={() => setTripType(t.value)}
                  />
                  <span className="selection-icon" aria-hidden="true">{t.icon}</span>
                  <span className="selection-title">{t.title}</span>
                  <i aria-hidden="true">✓</i>
                </label>
              ))}
            </fieldset>
            <small className="field-error">{errors.tripType}</small>
          </section>
        )}

        {/* Section 04: Profile & Travellers */}
        <section className="trip-section">
          <div className="section-heading">
            <span>04</span>
            <div>
              <h2>Tell us about yourself</h2>
              <p>Personal choices are optional; useful essentials are always included.</p>
            </div>
          </div>

          <fieldset className="selection-grid profile-grid">
            <legend>Who are you packing for? <b aria-hidden="true">*</b></legend>
            {[
              { value: 'Female', icon: '♀', detail: 'Personal care and accessories' },
              { value: 'Male', icon: '♂', detail: 'Grooming and accessories' },
              { value: 'Other', icon: '◉', detail: 'Other / prefer not to say' },
            ].map(p => (
              <label
                key={p.value}
                className={`selection-card profile-card ${profile === p.value ? 'selected' : ''}`}
                onClick={() => handleProfileChange(p.value)}
              >
                <input
                  type="radio"
                  name="profile"
                  value={p.value}
                  checked={profile === p.value}
                  onChange={() => handleProfileChange(p.value)}
                />
                <span className="selection-icon" aria-hidden="true">{p.icon}</span>
                <span className="selection-title">{p.value}</span>
                <small>{p.detail}</small>
                <i aria-hidden="true">✓</i>
              </label>
            ))}
          </fieldset>
          <small className="field-error">{errors.profile}</small>

          {/* Personalization Options Panel */}
          {profile === 'Other' ? (
            <div className="personalization-panel">
              <h3>Your essentials stay complete</h3>
              <p>Clothing, toiletries, medicines, documents, electronics and footwear stay part of your list. Add any personal items you want later.</p>
            </div>
          ) : (
            PROFILE_OPTIONS[profile] && (
              <div className="personalization-panel">
                <div className="personalization-header">
                  <div>
                    <h3>Optional preferences</h3>
                    <p>Select only what you would like to bring.</p>
                  </div>
                  <label
                    className={`select-all ${personalization.length === PROFILE_OPTIONS[profile].length ? 'checked' : ''}`}
                    onClick={toggleSelectAllPersonalization}
                  >
                    <span>Select all</span>
                  </label>
                </div>
                <div className="choice-grid">
                  {PROFILE_OPTIONS[profile].map(item => (
                    <label
                      key={item}
                      className={`choice ${personalization.includes(item) ? 'selected' : ''}`}
                      onClick={() => togglePersonalization(item)}
                    >
                      <input
                        type="checkbox"
                        checked={personalization.includes(item)}
                        onChange={() => togglePersonalization(item)}
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Travellers */}
          <div className="traveller-block">
            <div className="form-group adult-count">
              <label htmlFor="adults">Adults</label>
              <input
                id="adults"
                type="number"
                min="1"
                value={adults}
                onChange={e => setAdults(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>

            <div>
              <p className="traveller-question">Travelling with children?</p>
              <div className="yes-no-choice">
                <label className={!hasChildren ? 'selected' : ''} onClick={() => setHasChildren(false)}>
                  <input
                    type="radio"
                    name="has_children"
                    checked={!hasChildren}
                    onChange={() => setHasChildren(false)}
                  />
                  <span>No</span>
                </label>
                <label className={hasChildren ? 'selected' : ''} onClick={() => { setHasChildren(true); if (children === 0) setChildren(1); }}>
                  <input
                    type="radio"
                    name="has_children"
                    checked={hasChildren}
                    onChange={() => { setHasChildren(true); if (children === 0) setChildren(1); }}
                  />
                  <span>Yes</span>
                </label>
              </div>
            </div>

            {hasChildren && (
              <div className="child-fields">
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="children">Number of children</label>
                    <input
                      id="children"
                      type="number"
                      min="1"
                      value={children}
                      onChange={e => setChildren(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="child_age">Child age(s)</label>
                    <input
                      id="child_age"
                      type="text"
                      placeholder="e.g. 4 and 8 years"
                      value={childAge}
                      onChange={e => setChildAge(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Section 05: Activities OR Hostel */}
        {!isHostel ? (
          <section className="trip-section">
            <div className="section-heading section-heading-actions">
              <div className="section-heading">
                <span>05</span>
                <div>
                  <h2>What are you planning to do?</h2>
                  <p>Select activities that need special gear.</p>
                </div>
              </div>
              <label
                className={`select-all ${activities.length === ALL_ACTIVITIES.length ? 'checked' : ''}`}
                onClick={toggleSelectAllActivities}
              >
                <span>Select all</span>
              </label>
            </div>

            <div className="activity-grid">
              {ALL_ACTIVITIES.map(a => (
                <label
                  key={a.value}
                  className={`activity-card ${activities.includes(a.value) ? 'selected' : ''}`}
                  onClick={() => toggleActivity(a.value)}
                >
                  <input
                    type="checkbox"
                    checked={activities.includes(a.value)}
                    onChange={() => toggleActivity(a.value)}
                  />
                  <span className="activity-icon" aria-hidden="true">{a.icon}</span>
                  <span>{a.value}</span>
                </label>
              ))}
            </div>
          </section>
        ) : (
          <section className="trip-section">
            <div className="section-heading section-heading-actions">
              <div className="section-heading">
                <span>05</span>
                <div>
                  <h2>Hostel essentials</h2>
                  <p>Select the room and study items you need.</p>
                </div>
              </div>
              <label
                className={`select-all ${shiftingItems.length === HOSTEL_ITEMS.length ? 'checked' : ''}`}
                onClick={toggleSelectAllHostel}
              >
                <span>Select all</span>
              </label>
            </div>

            <div className="choice-grid">
              {HOSTEL_ITEMS.map(item => (
                <label
                  key={item}
                  className={`choice ${shiftingItems.includes(item) ? 'selected' : ''}`}
                  onClick={() => toggleHostelItem(item)}
                >
                  <input
                    type="checkbox"
                    checked={shiftingItems.includes(item)}
                    onChange={() => toggleHostelItem(item)}
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Section 06: Your bag */}
        <section className="trip-section">
          <div className="section-heading">
            <span>06</span>
            <div>
              <h2>Your bag</h2>
              <p>Choose the bag you’re taking. Baggage limits only apply to flights.</p>
            </div>
          </div>

          <fieldset className="selection-grid bag-grid">
            <legend className="sr-only">Bag type</legend>
            {[
              { value: 'Backpack', icon: '🎒', detail: 'Light and hands-free' },
              { value: 'Cabin Bag', icon: '🧳', detail: 'Ready for the overhead bin' },
              { value: 'Suitcase', icon: '▣', detail: 'More room for longer stays' },
            ].map(b => (
              <label
                key={b.value}
                className={`selection-card compact-card ${bagType === b.value ? 'selected' : ''}`}
                onClick={() => setBagType(b.value)}
              >
                <input
                  type="radio"
                  name="bag_type"
                  value={b.value}
                  checked={bagType === b.value}
                  onChange={() => setBagType(b.value)}
                />
                <span className="selection-icon" aria-hidden="true">{b.icon}</span>
                <span className="selection-title">{b.value}</span>
                <small>{b.detail}</small>
                <i aria-hidden="true">✓</i>
              </label>
            ))}
          </fieldset>

          <div className="baggage-note">
            {flightLegs.length === 0 && (
              <p>
                This journey has no flights, so <strong>no airline baggage limit applies</strong> —
                pack what fits your {bagType.toLowerCase()}.
              </p>
            )}
            {flightLegs.length > 0 && effectiveLimit != null && (
              <p>
                Your packing limit comes from your flight{flightLegs.length > 1 ? 's' : ''}: the
                smallest airline allowance applies, currently <strong>{effectiveLimit} kg</strong>.
                It applies to your flight leg{flightLegs.length > 1 ? 's' : ''} only, not to the
                rest of your journey.
              </p>
            )}
            {flightLegs.length > 0 && effectiveLimit == null && (
              <p>
                You have a flight in this journey but haven't entered its baggage allowance, so{' '}
                <strong>no baggage limit will be enforced</strong>. BagBuddy won't guess your
                airline's allowance — add it in the flight leg above whenever you're ready.
              </p>
            )}
          </div>
        </section>

        {/* Extra Toiletries */}
        <section className="trip-section optional-section">
          <div className="section-heading section-heading-actions">
            <div className="section-heading">
              <span>EXTRA</span>
              <div>
                <h2>Optional toiletries</h2>
                <p>Common basics are already included. Add extras you want to pack.</p>
              </div>
            </div>
            <label
              className={`select-all ${toiletries.length === TOILETRIES_OPTIONS.length ? 'checked' : ''}`}
              onClick={toggleSelectAllToiletries}
            >
              <span>Select all</span>
            </label>
          </div>

          <div className="choice-grid">
            {TOILETRIES_OPTIONS.map(item => (
              <label
                key={item}
                className={`choice ${toiletries.includes(item) ? 'selected' : ''}`}
                onClick={() => toggleToiletry(item)}
              >
                <input
                  type="checkbox"
                  checked={toiletries.includes(item)}
                  onChange={() => toggleToiletry(item)}
                />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Submit Button */}
        <div className="generate-container">
          <button
            type="submit"
            className="generate-packing-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating your packing list…' : 'Generate my packing list'} <span aria-hidden="true">→</span>
          </button>
          <p>Universal essentials plus the selections you made, ready for your next getaway.</p>
        </div>
      </form>
    </main>
  );
};
