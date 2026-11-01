import { useState, useEffect, useRef } from 'react';
import { User, Trip, PackingListResult, PackingItem } from './types';
import { createTrip, currentUser as getCurrentUser, listTrips, loadPackingList, packingListFromItems, syncPackingItems } from './lib/data';
import { supabase, supabaseConfigured } from './lib/supabase';
import { Header } from './components/Header';
import { Home } from './components/Home';
import { Dashboard } from './components/Dashboard';
import { TripSetup } from './components/TripSetup';
import { MyTrips } from './components/MyTrips';
import { Auth } from './components/Auth';
import { ChatAssistant } from './components/ChatAssistant';

export function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentTrip, setCurrentTripState] = useState<Trip | null>(null);
  const [currentPackingList, setCurrentPackingListState] = useState<PackingListResult | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'home' | 'dashboard' | 'setup' | 'trips' | 'login' | 'signup'>('home');
  const hydrationId = useRef(0);

  async function refreshTrips(preferredTripId?: string) {
    const requestId = ++hydrationId.current;
    setIsLoading(true);
    setRestoreError(null);

    try {
      const user = await getCurrentUser();
      if (!user) {
        if (requestId === hydrationId.current) {
          setCurrentUser(null);
          setTrips([]);
          setCurrentTripState(null);
          setCurrentPackingListState(null);
          setActiveView('home');
        }
        return;
      }

      const nextTrips = await listTrips();
      const selectedTrip = preferredTripId
        ? nextTrips.find(trip => trip.id === preferredTripId) ?? nextTrips[0] ?? null
        : nextTrips[0] ?? null;
      const selectedList = selectedTrip ? await loadPackingList(selectedTrip) : null;

      if (requestId !== hydrationId.current) return;
      setCurrentUser(user);
      setTrips(nextTrips);
      setCurrentTripState(selectedTrip);
      setCurrentPackingListState(selectedList);
      setActiveView(selectedTrip ? 'dashboard' : 'setup');
    } catch (error) {
      if (requestId === hydrationId.current) {
        console.error('Could not restore Supabase session:', error);
        setRestoreError(error instanceof Error ? error.message : 'Could not load your travel plans.');
      }
    } finally {
      if (requestId === hydrationId.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!supabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    void refreshTrips();
    const { data: subscription } = supabase().auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (!session) {
        hydrationId.current += 1;
        setCurrentUser(null);
        setTrips([]);
        setCurrentTripState(null);
        setCurrentPackingListState(null);
        setIsLoading(false);
        setRestoreError(null);
        setActiveView('home');
        return;
      }
      await refreshTrips();
    });
    return () => {
      hydrationId.current += 1;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const selectTrip = async (trip: Trip) => {
    const list = await loadPackingList(trip);
    setCurrentTripState(trip);
    setCurrentPackingListState(list);
  };

  const handleLogout = async () => {
    await supabase().auth.signOut();
    setCurrentUser(null);
    setTrips([]);
    setCurrentTripState(null);
    setCurrentPackingListState(null);
    setActiveView('home');
  };

  const handleAuthSuccess = (user: User) => {
    void user;
    void refreshTrips();
  };

  const handleTripCreated = async (trip: Trip, list: PackingListResult) => {
    if (!currentUser) throw new Error('Please log in before saving a trip.');
    const savedTrip = await createTrip(trip, list, currentUser.id);
    await refreshTrips(savedTrip.id);
  };

  const handleUpdatePackingList = async (list: PackingListResult) => {
    if (!currentTrip?.id) throw new Error('Select a trip before updating its packing list.');
    setCurrentPackingListState(list);
    await syncPackingItems(currentTrip.id, list.items);
  };

  // Chat-triggered modifications to real packing list
  const handleAddItemFromChat = (item: { name: string; category?: string; quantity?: number; weight?: number }) => {
    if (!currentTrip || !currentPackingList) return;
    const categoryKey = item.category || 'Other Essentials';
    const qty = item.quantity || 1;
    const unitWeight = item.weight !== undefined ? item.weight : 0.25;

    const newItem: PackingItem = {
      id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: item.name,
      quantity: qty,
      weight: Number((qty * unitWeight).toFixed(2)),
      category: categoryKey,
      packed: false,
    };

    void handleUpdatePackingList(packingListFromItems(currentTrip, [...currentPackingList.items, newItem]));
  };

  const handleRemoveItemFromChat = (itemName: string): boolean => {
    if (!currentTrip || !currentPackingList) return false;
    const search = itemName.trim().toLowerCase();
    const index = currentPackingList.items.findIndex(
      item => item.name.toLowerCase().includes(search) || search.includes(item.name.toLowerCase())
    );
    if (index === -1) return false;
    const updatedItems = currentPackingList.items.filter((_, i) => i !== index);
    void handleUpdatePackingList(packingListFromItems(currentTrip, updatedItems));
    return true;
  };

  const handleTogglePackedFromChat = (itemName: string, packed: boolean): boolean => {
    if (!currentTrip || !currentPackingList) return false;
    const search = itemName.trim().toLowerCase();
    let updated = false;
    const updatedItems = currentPackingList.items.map(item => {
      if (!updated && (item.name.toLowerCase().includes(search) || search.includes(item.name.toLowerCase()))) {
        updated = true;
        return { ...item, packed };
      }
      return item;
    });
    if (!updated) return false;
    void handleUpdatePackingList(packingListFromItems(currentTrip, updatedItems));
    return true;
  };

  if (isLoading) {
    return <div className="loading-state">Loading your travel plans…</div>;
  }

  if (restoreError) {
    return (
      <main className="loading-state">
        <p>{restoreError}</p>
        <button className="primary-btn" onClick={() => void refreshTrips()}>Try again</button>
      </main>
    );
  }

  return (
    <div className="app-container">
      {!supabaseConfigured() && (
        <div className="loading-state">Configure Supabase to use BagBuddy. See .env.example.</div>
      )}
      {/* Show header for all views except dedicated auth page */}
      {activeView !== 'login' && activeView !== 'signup' && (
        <Header
          currentUser={currentUser}
          activeView={activeView}
          setActiveView={setActiveView}
          onLogout={() => void handleLogout()}
        />
      )}

      {activeView === 'home' && (
        <Home
          currentUser={currentUser}
          currentTrip={currentTrip}
          currentPackingList={currentPackingList}
          onNavigate={view => setActiveView(view)}
        />
      )}

      {activeView === 'dashboard' && (
        <Dashboard
          currentUser={currentUser}
          currentTrip={currentTrip}
          currentPackingList={currentPackingList}
          onNavigate={view => setActiveView(view)}
          onUpdatePackingList={list => void handleUpdatePackingList(list)}
        />
      )}

      {activeView === 'setup' && (
        <TripSetup
          onTripCreated={handleTripCreated}
          onCancel={() => setActiveView('dashboard')}
        />
      )}

      {activeView === 'trips' && (
        <MyTrips
          trips={trips}
          onSelectTrip={async (trip) => {
            await selectTrip(trip);
            setActiveView('dashboard');
          }}
          onNavigate={view => setActiveView(view)}
          onRefreshTrips={refreshTrips}
        />
      )}

      {(activeView === 'login' || activeView === 'signup') && (
        <Auth
          mode={activeView}
          onSuccess={handleAuthSuccess}
          onSwitchMode={mode => setActiveView(mode)}
          onBack={() => setActiveView('home')}
        />
      )}

      {/* Floating AI Travel & Packing Assistant */}
      <ChatAssistant
        currentTrip={currentTrip}
        currentPackingList={currentPackingList}
        onAddItem={handleAddItemFromChat}
        onRemoveItem={handleRemoveItemFromChat}
        onTogglePacked={handleTogglePackedFromChat}
        onNavigate={view => setActiveView(view)}
      />
    </div>
  );
}

export default App;
