import { useState, useEffect } from 'react';
import { User, Trip, PackingListResult, PackingItem } from './types';
import {
  getCurrentUser,
  getCurrentTrip,
  getCurrentPackingList,
  getTrips,
  logout,
  saveTrip,
  setCurrentPackingList,
} from './storage';
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
  const [activeView, setActiveView] = useState<'home' | 'dashboard' | 'setup' | 'trips' | 'login' | 'signup'>('home');

  useEffect(() => {
    setCurrentUser(getCurrentUser());
    setCurrentTripState(getCurrentTrip());
    setCurrentPackingListState(getCurrentPackingList());
    setTrips(getTrips());
  }, []);

  const refreshTrips = () => {
    setTrips(getTrips());
    setCurrentTripState(getCurrentTrip());
    setCurrentPackingListState(getCurrentPackingList());
  };

  const handleLogout = () => {
    logout();
    setCurrentUser(null);
    setActiveView('home');
  };

  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
    setActiveView('dashboard');
    refreshTrips();
  };

  const handleTripCreated = (trip: Trip, list: PackingListResult) => {
    setCurrentTripState(trip);
    setCurrentPackingListState(list);
    refreshTrips();
    setActiveView('dashboard');
  };

  const handleUpdatePackingList = (list: PackingListResult) => {
    setCurrentPackingListState(list);
    setCurrentPackingList(list);
  };

  const handleSelectTrip = (trip: Trip, list: PackingListResult) => {
    setCurrentTripState(trip);
    setCurrentPackingListState(list);
    setActiveView('dashboard');
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

    const updatedCategories = { ...currentPackingList.categories };
    if (!updatedCategories[categoryKey]) {
      updatedCategories[categoryKey] = [];
    }
    updatedCategories[categoryKey] = [...updatedCategories[categoryKey], newItem];

    const updatedItems = [...currentPackingList.items, newItem];
    const newTotalWeight = Number(
      updatedItems.reduce((acc, curr) => acc + curr.weight, 0).toFixed(2)
    );
    const newRemaining = Number((currentPackingList.weight_limit - newTotalWeight).toFixed(2));
    const isOverloaded = newTotalWeight > currentPackingList.weight_limit;

    const updatedList: PackingListResult = {
      ...currentPackingList,
      categories: updatedCategories,
      items: updatedItems,
      total_weight: newTotalWeight,
      remaining_weight: newRemaining,
      overloaded: isOverloaded,
    };

    handleUpdatePackingList(updatedList);
    saveTrip(currentTrip, updatedList);
  };

  const handleRemoveItemFromChat = (itemName: string): boolean => {
    if (!currentTrip || !currentPackingList) return false;
    const search = itemName.trim().toLowerCase();

    let found = false;
    const updatedCategories: Record<string, PackingItem[]> = {};

    for (const [cat, items] of Object.entries(currentPackingList.categories)) {
      const remainingInCat = items.filter(item => {
        const match = item.name.toLowerCase().includes(search) || search.includes(item.name.toLowerCase());
        if (match && !found) {
          found = true;
          return false;
        }
        return true;
      });
      if (remainingInCat.length > 0) {
        updatedCategories[cat] = remainingInCat;
      }
    }

    if (!found) return false;

    const updatedItems: PackingItem[] = [];
    for (const catItems of Object.values(updatedCategories)) {
      updatedItems.push(...catItems);
    }

    const newTotalWeight = Number(
      updatedItems.reduce((acc, curr) => acc + curr.weight, 0).toFixed(2)
    );
    const newRemaining = Number((currentPackingList.weight_limit - newTotalWeight).toFixed(2));
    const isOverloaded = newTotalWeight > currentPackingList.weight_limit;

    const updatedList: PackingListResult = {
      ...currentPackingList,
      categories: updatedCategories,
      items: updatedItems,
      total_weight: newTotalWeight,
      remaining_weight: newRemaining,
      overloaded: isOverloaded,
    };

    handleUpdatePackingList(updatedList);
    saveTrip(currentTrip, updatedList);
    return true;
  };

  const handleTogglePackedFromChat = (itemName: string, packed: boolean): boolean => {
    if (!currentTrip || !currentPackingList) return false;
    const search = itemName.trim().toLowerCase();

    let updated = false;
    const updatedCategories: Record<string, PackingItem[]> = {};
    const updatedItems = currentPackingList.items.map(item => {
      if ((item.name.toLowerCase().includes(search) || search.includes(item.name.toLowerCase())) && !updated) {
        updated = true;
        return { ...item, packed };
      }
      return item;
    });

    for (const [cat, items] of Object.entries(currentPackingList.categories)) {
      updatedCategories[cat] = items.map(item => {
        if (item.name.toLowerCase().includes(search) || search.includes(item.name.toLowerCase())) {
          return { ...item, packed };
        }
        return item;
      });
    }

    if (!updated) return false;

    const updatedList: PackingListResult = {
      ...currentPackingList,
      categories: updatedCategories,
      items: updatedItems,
    };

    handleUpdatePackingList(updatedList);
    saveTrip(currentTrip, updatedList);
    return true;
  };

  return (
    <div className="app-container">
      {/* Show header for all views except dedicated auth page */}
      {activeView !== 'login' && activeView !== 'signup' && (
        <Header
          currentUser={currentUser}
          activeView={activeView}
          setActiveView={setActiveView}
          onLogout={handleLogout}
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
          onUpdatePackingList={handleUpdatePackingList}
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
          onSelectTrip={handleSelectTrip}
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
