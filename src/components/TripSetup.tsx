import React, { useState } from 'react';
import { Trip, PackingListResult } from '../types';
import { generatePackingList } from '../packingEngine';
import { saveTrip } from '../storage';

interface TripSetupProps {
  onTripCreated: (trip: Trip, list: PackingListResult) => void;
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
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [travelMode, setTravelMode] = useState('Flight');
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
  const [weightLimit, setWeightLimit] = useState(7);
  const [toiletries, setToiletries] = useState<string[]>(['Toothbrush', 'Toothpaste', 'Soap', 'Sunscreen']);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isHostel = travelMode === 'Hostel';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!destination.trim()) {
      newErrors.destination = 'Please provide destination.';
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
    if (!travelMode) {
      newErrors.travelMode = 'Please choose a travel mode.';
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

    const tripData: Trip = {
      destination: destination.trim(),
      start_date: startDate,
      end_date: endDate,
      travel_mode: travelMode,
      trip_type: isHostel ? '' : tripType,
      profile,
      adults: Number(adults) || 1,
      children: hasChildren ? Number(children) || 0 : 0,
      child_age: hasChildren ? childAge : '',
      bag_type: bagType,
      weight_limit: Number(weightLimit) || 7,
      activities: isHostel ? [] : activities,
      personalization,
      toiletries,
      shifting_items: isHostel ? shiftingItems : [],
    };

    const packingList = generatePackingList(tripData);
    const saved = saveTrip(tripData, packingList);

    setTimeout(() => {
      setIsSubmitting(false);
      onTripCreated(saved, packingList);
    }, 200);
  };

  return (
    <main className="trip-page">
      <header className="page-intro">
        <p className="eyebrow">PLAN YOUR ESCAPE</p>
        <h1>Where will your next story take you?</h1>
        <p>Start with the essentials, choose your travel style, and leave with a packing list that feels ready for the journey.</p>
      </header>

      <form onSubmit={handleSubmit} noValidate>
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
              <div className="input-with-mark">
                <span aria-hidden="true">⌖</span>
                <input
                  id="destination"
                  type="text"
                  placeholder="Goa, Mumbai, Paris…"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  aria-invalid={!!errors.destination}
                />
              </div>
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

        {/* Section 02: Travel Mode */}
        <section className="trip-section">
          <div className="section-heading">
            <span>02</span>
            <div>
              <h2>How are you travelling?</h2>
              <p>Choose the journey that best matches your plan.</p>
            </div>
          </div>

          <fieldset className="selection-grid mode-grid">
            <legend className="sr-only">Travel mode</legend>
            {[
              { value: 'Flight', icon: '✈', title: 'Flight', detail: 'Fast & convenient' },
              { value: 'Train', icon: '🚆', title: 'Train', detail: 'Settle in and enjoy the view' },
              { value: 'Bus', icon: '🚌', title: 'Bus', detail: 'Easy and flexible' },
              { value: 'Car', icon: '🚗', title: 'Car', detail: 'Go at your own pace' },
              { value: 'Hostel', icon: '🧳', title: 'Hostel move', detail: 'Packing for a new room' },
            ].map(m => (
              <label
                key={m.value}
                className={`selection-card ${travelMode === m.value ? 'selected' : ''}`}
                onClick={() => setTravelMode(m.value)}
              >
                <input
                  type="radio"
                  name="travel_mode"
                  value={m.value}
                  checked={travelMode === m.value}
                  onChange={() => setTravelMode(m.value)}
                />
                <span className="selection-icon" aria-hidden="true">{m.icon}</span>
                <span className="selection-title">{m.title}</span>
                <small>{m.detail}</small>
                <i aria-hidden="true">✓</i>
              </label>
            ))}
          </fieldset>
          <small className="field-error">{errors.travelMode}</small>
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
              <p>Choose the bag you’re taking and its weight allowance.</p>
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

          <div className="form-grid bag-weight">
            <div className="form-group">
              <label htmlFor="weight_limit">Bag weight limit (kg)</label>
              <input
                id="weight_limit"
                type="number"
                value={weightLimit}
                min="1"
                step="0.5"
                onChange={e => setWeightLimit(parseFloat(e.target.value) || 7)}
              />
            </div>
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
