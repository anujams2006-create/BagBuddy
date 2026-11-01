import React, { useEffect, useId, useRef, useState } from 'react';
import { searchPlaces, type PlaceResult } from '../lib/weather';

interface PlaceAutocompleteProps {
  /** Element id for the input; the label in the parent form points at it. */
  id: string;
  /** The verified place the user has picked, or null if none is selected. */
  selectedPlace: PlaceResult | null;
  /** Called with a place on selection, and with null as soon as the text no longer matches the selection. */
  onChange: (place: PlaceResult | null) => void;
  hasError?: boolean;
}

type SearchState = 'idle' | 'loading' | 'done' | 'error';

/**
 * Destination input with real place suggestions from the Open-Meteo
 * Geocoding API. Only a place picked from the list counts as a location:
 * typing free text clears the selection, so unselected text is never saved
 * as a verified destination. Requests are debounced (300 ms) and superseded
 * requests are aborted.
 */
export const PlaceAutocomplete: React.FC<PlaceAutocompleteProps> = ({
  id,
  selectedPlace,
  onChange,
  hasError = false,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = useId();

  // When a place gets selected, show its display name and close the list.
  // (Clearing the selection by typing must not wipe the text being typed,
  // so this only reacts to a non-null selection.)
  useEffect(() => {
    if (!selectedPlace) return;
    setQuery(selectedPlace.displayName);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, [selectedPlace]);

  // Debounced place search.
  useEffect(() => {
    if (selectedPlace && query === selectedPlace.displayName) {
      setSearchState('idle');
      setResults([]);
      return;
    }
    if (query.trim().length < 2) {
      setSearchState('idle');
      setResults([]);
      return;
    }
    setSearchState('loading');
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then(places => {
          setResults(places);
          setSearchState('done');
          setIsOpen(true);
          setHighlightedIndex(places.length ? 0 : -1);
        })
        .catch(error => {
          if ((error as Error)?.name === 'AbortError') return;
          setResults([]);
          setSearchState('error');
          setIsOpen(true);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedPlace]);

  const selectPlace = (place: PlaceResult) => {
    onChange(place);
    setIsOpen(false);
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (selectedPlace && value !== selectedPlace.displayName) {
      // The text no longer describes the picked place: it is unverified again.
      onChange(null);
    }
    if (value.trim().length >= 2) setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && results.length) setIsOpen(true);
      setHighlightedIndex(prev => (results.length ? (prev + 1) % results.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (results.length ? (prev - 1 + results.length) % results.length : -1));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
        e.preventDefault();
        selectPlace(results[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const showDropdown = isOpen && !selectedPlace && query.trim().length >= 2;

  return (
    <div className="place-autocomplete">
      <div className="input-with-mark">
        <span aria-hidden="true">⌖</span>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={
            showDropdown && highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Start typing a city or place…"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!selectedPlace && query.trim().length >= 2) setIsOpen(true);
          }}
          onBlur={() => {
            // Delay so a click on an option registers before the list closes.
            setTimeout(() => setIsOpen(false), 150);
          }}
          aria-invalid={hasError}
        />
      </div>

      {showDropdown && (
        <ul className="place-dropdown" role="listbox" id={listboxId} aria-label="Place suggestions">
          {searchState === 'loading' && (
            <li className="place-status" role="status">Searching places…</li>
          )}
          {searchState === 'error' && (
            <li className="place-status" role="alert">
              Place search is unavailable right now. Check your connection and keep typing to try again.
            </li>
          )}
          {searchState === 'done' && results.length === 0 && (
            <li className="place-status" role="status">No places found for “{query.trim()}”. Try a different spelling.</li>
          )}
          {searchState === 'done' &&
            results.map((place, index) => (
              <li
                key={place.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                className={`place-option ${index === highlightedIndex ? 'active' : ''}`}
                onMouseDown={e => {
                  e.preventDefault();
                  selectPlace(place);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="place-option-name">{place.name}</span>
                <small>
                  {[place.admin1, place.country].filter(Boolean).join(', ')}
                </small>
              </li>
            ))}
        </ul>
      )}

      {selectedPlace ? (
        <p className="place-selected-note">
          ✓ Selected: {selectedPlace.displayName} — weather will use this exact location.
        </p>
      ) : (
        <p className="place-hint">Pick a place from the suggestions so we can fetch accurate weather for it.</p>
      )}
    </div>
  );
};
