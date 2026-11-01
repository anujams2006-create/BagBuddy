import React, { useState } from 'react';
import { Trip, PackingListResult, User, PackingItem } from '../types';

interface DashboardProps {
  currentUser: User | null;
  currentTrip: Trip | null;
  currentPackingList: PackingListResult | null;
  onNavigate: (view: 'setup' | 'trips') => void;
  onUpdatePackingList: (list: PackingListResult) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  currentUser,
  currentTrip,
  currentPackingList,
  onNavigate,
  onUpdatePackingList,
}) => {
  const [newItemName, setNewItemName] = useState('');
  const [newItemCat, setNewItemCat] = useState('Personal Care');
  const [showAddModal, setShowAddModal] = useState(false);

  if (!currentTrip || !currentPackingList) {
    return (
      <main className="dashboard-container">
        <section className="dashboard-header">
          <div>
            <p className="welcome-badge">PACKING DASHBOARD</p>
            <h1>Welcome back, {currentUser?.name || 'Traveler'}.</h1>
            <p>Keep the details of your next trip in one practical place.</p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => onNavigate('trips')} className="secondary-btn">
              My Trips
            </button>
            <button onClick={() => onNavigate('setup')} className="new-trip-btn">
              Plan a new trip
            </button>
          </div>
        </section>

        <section className="empty-dashboard">
          <h2>Your next list starts here.</h2>
          <p>Add your trip details and BagBuddy will prepare a personalized, categorized list.</p>
          <button onClick={() => onNavigate('setup')} className="generate-trip-btn">
            Plan my trip
          </button>
        </section>
      </main>
    );
  }

  // Calculate packed progress
  const allItems = currentPackingList.items;
  const packedCount = allItems.filter(item => item.packed).length;
  const progressPercent = allItems.length ? Math.round((packedCount / allItems.length) * 100) : 0;

  const handleToggleItem = (itemId: string) => {
    const updatedCategories: Record<string, PackingItem[]> = {};
    const updatedItems = currentPackingList.items.map(item => {
      if (item.id === itemId) {
        return { ...item, packed: !item.packed };
      }
      return item;
    });

    for (const [cat, items] of Object.entries(currentPackingList.categories)) {
      updatedCategories[cat] = items.map(item => {
        if (item.id === itemId) {
          return { ...item, packed: !item.packed };
        }
        return item;
      });
    }

    const updatedList: PackingListResult = {
      ...currentPackingList,
      categories: updatedCategories,
      items: updatedItems,
    };

    onUpdatePackingList(updatedList);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const categoryKey = newItemCat.trim() || 'Custom Essentials';
    const newItem: PackingItem = {
      id: `custom_${Date.now()}`,
      name: newItemName.trim(),
      quantity: 1,
      weight: 0.15,
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

    onUpdatePackingList(updatedList);
    setNewItemName('');
    setShowAddModal(false);
  };

  const handleRemoveItem = (itemId: string, category: string) => {
    const updatedCategories = { ...currentPackingList.categories };
    if (updatedCategories[category]) {
      updatedCategories[category] = updatedCategories[category].filter(i => i.id !== itemId);
      if (updatedCategories[category].length === 0) {
        delete updatedCategories[category];
      }
    }

    const updatedItems = currentPackingList.items.filter(i => i.id !== itemId);
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

    onUpdatePackingList(updatedList);
  };

  return (
    <main className="dashboard-container">
      <section className="dashboard-header">
        <div>
          <p className="welcome-badge">PACKING DASHBOARD</p>
          <h1>Welcome back, {currentUser?.name || 'Traveler'}.</h1>
          <p>Keep the details of your next trip in one practical place.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => onNavigate('trips')} className="secondary-btn">
            My Trips
          </button>
          <button onClick={() => onNavigate('setup')} className="new-trip-btn">
            Plan a new trip
          </button>
        </div>
      </section>

      {/* Trip Summary Card */}
      <section className="trip-summary-card">
        <div className="trip-summary-header">
          <div>
            <p className="trip-label">CURRENT TRIP</p>
            <h2>{currentTrip.destination}</h2>
          </div>
          <span className="trip-status">Active plan</span>
        </div>
        <div className="trip-details">
          <div className="trip-detail">
            <span>Travel dates</span>
            <strong>{currentTrip.start_date} – {currentTrip.end_date}</strong>
          </div>
          <div className="trip-detail">
            <span>Travel mode</span>
            <strong>{currentTrip.travel_mode}</strong>
          </div>
          <div className="trip-detail">
            <span>Packing profile</span>
            <strong>{currentTrip.profile}</strong>
          </div>
          <div className="trip-detail">
            <span>Bag type</span>
            <strong>{currentTrip.bag_type}</strong>
          </div>
        </div>
      </section>

      {/* Weight Summary */}
      <section className="weight-summary" aria-label="Bag weight">
        <div className="weight-card">
          <span>Estimated weight</span>
          <h2>{currentPackingList.total_weight} kg</h2>
        </div>
        <div className="weight-card">
          <span>Bag limit</span>
          <h2>{currentPackingList.weight_limit} kg</h2>
        </div>
        <div className="weight-card">
          <span>{currentPackingList.overloaded ? 'Over by' : 'Remaining'}</span>
          <h2>
            {currentPackingList.overloaded
              ? (currentPackingList.total_weight - currentPackingList.weight_limit).toFixed(2)
              : currentPackingList.remaining_weight}{' '}
            kg
          </h2>
        </div>
      </section>

      {/* Overload Alert or Success */}
      {currentPackingList.overloaded ? (
        <section className="overload-warning">
          <div>
            <h2>Your bag is over the recommended limit.</h2>
            <p>
              Estimated weight is {currentPackingList.total_weight} kg against a {currentPackingList.weight_limit} kg limit. Consider removing roughly {(currentPackingList.total_weight - currentPackingList.weight_limit).toFixed(2)} kg.
            </p>
            {currentPackingList.items_to_remove && currentPackingList.items_to_remove.length > 0 && (
              <p style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                💡 Suggested items to leave behind: {currentPackingList.items_to_remove.map(i => `${i.name} (${i.weight}kg)`).join(', ')}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="weight-success">
          <div>
            <h2>Your bag is within the limit.</h2>
            <p>You have {currentPackingList.remaining_weight} kg available for additional items.</p>
          </div>
        </section>
      )}

      {/* Checklist Section */}
      <section className="packing-section">
        <div className="packing-section-header">
          <div>
            <p className="section-label">YOUR LIST</p>
            <h2>Packing checklist</h2>
            <p>{currentPackingList.items.length} items organized for this trip.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <button
              onClick={() => setShowAddModal(!showAddModal)}
              className="secondary-btn"
              style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.85rem' }}
            >
              + Add Item
            </button>
            <div className="packing-progress">
              <span>Packing progress</span>
              <strong id="progressText">{progressPercent}%</strong>
            </div>
          </div>
        </div>

        {/* Add custom item inline modal */}
        {showAddModal && (
          <form
            onSubmit={handleAddItem}
            style={{
              background: '#fdfaf6',
              border: '1px solid var(--border-strong)',
              borderRadius: '10px',
              padding: '16px',
              marginBottom: '24px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              placeholder="Item name (e.g. Travel Adapter)"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              style={{ flex: 1, minWidth: '180px' }}
              required
            />
            <select
              value={newItemCat}
              onChange={e => setNewItemCat(e.target.value)}
              style={{ minWidth: '150px' }}
            >
              <option value="👕 Clothes">👕 Clothes</option>
              <option value="🧴 Toiletries">🧴 Toiletries</option>
              <option value="🔌 Electronics">🔌 Electronics</option>
              <option value="📄 Documents">📄 Documents</option>
              <option value="Personal Care">Personal Care</option>
              <option value="Accessories">Accessories</option>
              <option value="Other Essentials">Other Essentials</option>
            </select>
            <button type="submit" className="primary-btn" style={{ minHeight: '44px' }}>
              Add to list
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowAddModal(false)}
              style={{ minHeight: '44px' }}
            >
              Cancel
            </button>
          </form>
        )}

        {Object.entries(currentPackingList.categories).map(([category, catItems]) => (
          <section key={category} className="packing-category">
            <div className="category-header">
              <h3>{category}</h3>
              <span className="category-count">{catItems.length} items</span>
            </div>
            <div className="packing-items">
              {catItems.map(item => (
                <div key={item.id} className={`packing-item ${item.packed ? 'packed' : ''}`}>
                  <label className="item-left">
                    <input
                      type="checkbox"
                      className="packing-checkbox"
                      checked={item.packed}
                      onChange={() => handleToggleItem(item.id)}
                    />
                    <span className="item-name">{item.name}</span>
                  </label>
                  <div className="item-info">
                    <span>Qty {item.quantity}</span>
                    <span>{item.weight} kg</span>
                    <button
                      onClick={() => handleRemoveItem(item.id, category)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        padding: '0 4px',
                        fontSize: '0.8rem',
                      }}
                      title="Remove item"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
};
