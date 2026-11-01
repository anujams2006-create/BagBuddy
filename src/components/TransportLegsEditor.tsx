import React from 'react';
import type { TransportLeg, TransportType } from '../types';
import { createTransportLeg, TRANSPORT_TYPES, transportIcon } from '../lib/transport';

interface TransportLegsEditorProps {
  legs: TransportLeg[];
  onChange: (legs: TransportLeg[]) => void;
}

/**
 * Editor for a trip's journey legs. Each leg is origin → destination by one
 * kind of transport; legs can be added, edited, removed, and reordered.
 * Plane legs additionally ask for that airline's baggage allowance — it is
 * never guessed, and it is the only place a baggage limit comes from.
 */
export const TransportLegsEditor: React.FC<TransportLegsEditorProps> = ({ legs, onChange }) => {
  const updateLeg = (id: string, patch: Partial<TransportLeg>) => {
    onChange(legs.map(leg => (leg.id === id ? { ...leg, ...patch } : leg)));
  };

  const removeLeg = (id: string) => {
    onChange(legs.filter(leg => leg.id !== id));
  };

  const moveLeg = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= legs.length) return;
    const next = [...legs];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addLeg = () => {
    const previous = legs[legs.length - 1];
    onChange([
      ...legs,
      createTransportLeg({
        // Chain the route: the new leg starts where the last one ended.
        origin: previous ? previous.destination : '',
        transport_type: 'Plane',
      }),
    ]);
  };

  return (
    <div className="legs-editor">
      {legs.map((leg, index) => (
        <fieldset key={leg.id} className="leg-card">
          <legend className="leg-card-title">
            {transportIcon(leg.transport_type)} Leg {index + 1}
          </legend>

          <div className="leg-fields">
            <div className="form-group">
              <label htmlFor={`leg-${leg.id}-origin`}>From</label>
              <input
                id={`leg-${leg.id}-origin`}
                type="text"
                placeholder="e.g. Pune"
                value={leg.origin}
                onChange={e => updateLeg(leg.id, { origin: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`leg-${leg.id}-destination`}>To</label>
              <input
                id={`leg-${leg.id}-destination`}
                type="text"
                placeholder="e.g. Mumbai"
                value={leg.destination}
                onChange={e => updateLeg(leg.id, { destination: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`leg-${leg.id}-type`}>Transport</label>
              <select
                id={`leg-${leg.id}-type`}
                value={leg.transport_type}
                onChange={e =>
                  updateLeg(leg.id, {
                    transport_type: e.target.value as TransportType,
                    // Baggage allowances belong to flights only.
                    baggage_allowance_kg:
                      e.target.value === 'Plane' ? leg.baggage_allowance_kg : null,
                  })
                }
              >
                {TRANSPORT_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.icon} {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={`leg-${leg.id}-departure`}>Departs (optional)</label>
              <input
                id={`leg-${leg.id}-departure`}
                type="time"
                value={leg.departure_time ?? ''}
                onChange={e => updateLeg(leg.id, { departure_time: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`leg-${leg.id}-arrival`}>Arrives (optional)</label>
              <input
                id={`leg-${leg.id}-arrival`}
                type="time"
                value={leg.arrival_time ?? ''}
                onChange={e => updateLeg(leg.id, { arrival_time: e.target.value })}
              />
            </div>
          </div>

          {leg.transport_type === 'Plane' && (
            <div className="leg-flight-row">
              <div className="form-group">
                <label htmlFor={`leg-${leg.id}-allowance`}>Airline baggage allowance (kg)</label>
                <input
                  id={`leg-${leg.id}-allowance`}
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 15"
                  value={leg.baggage_allowance_kg ?? ''}
                  onChange={e =>
                    updateLeg(leg.id, {
                      baggage_allowance_kg: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                />
                <small className="leg-hint">
                  Check your ticket or airline — BagBuddy won't guess this. Leave it blank if you
                  don't know it yet; no limit will be enforced for this flight until you add it.
                </small>
              </div>
            </div>
          )}

          <div className="leg-actions">
            <button
              type="button"
              className="leg-action-btn"
              onClick={() => moveLeg(index, -1)}
              disabled={index === 0}
              aria-label={`Move leg ${index + 1} up`}
            >
              ↑ Up
            </button>
            <button
              type="button"
              className="leg-action-btn"
              onClick={() => moveLeg(index, 1)}
              disabled={index === legs.length - 1}
              aria-label={`Move leg ${index + 1} down`}
            >
              ↓ Down
            </button>
            <button
              type="button"
              className="leg-action-btn leg-remove-btn"
              onClick={() => removeLeg(leg.id)}
              disabled={legs.length <= 1}
              aria-label={`Remove leg ${index + 1}`}
            >
              ✕ Remove
            </button>
          </div>
        </fieldset>
      ))}

      <button type="button" className="add-leg-btn" onClick={addLeg}>
        + Add another leg
      </button>
    </div>
  );
};
