import React, { useState, useEffect, useRef } from 'react';
import { Trip, PackingListResult } from '../types';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  actionSummary?: string;
  timestamp: string;
}

interface ChatAssistantProps {
  currentTrip: Trip | null;
  currentPackingList: PackingListResult | null;
  onAddItem: (item: { name: string; category?: string; quantity?: number; weight?: number }) => void;
  onRemoveItem: (itemName: string) => boolean;
  onTogglePacked: (itemName: string, packed: boolean) => boolean;
  onNavigate?: (view: 'setup' | 'dashboard' | 'trips') => void;
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: "Hi! I'm your BagBuddy travel assistant. I can help you plan your trip, decide what to pack, check weather-based recommendations, and keep your bag within its weight limit. What would you like help with?",
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

export const ChatAssistant: React.FC<ChatAssistantProps> = ({
  currentTrip,
  currentPackingList,
  onAddItem,
  onRemoveItem,
  onTogglePacked,
  onNavigate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([WELCOME_MESSAGE]);
  }, [currentTrip?.id]);

  const updateMessages = (newMessages: Message[]) => {
    setMessages(newMessages);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleClearChat = () => {
    updateMessages([WELCOME_MESSAGE]);
  };

  const handleSendMessage = async (userText: string) => {
    if (!userText.trim() || isLoading) return;

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: userText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    updateMessages(nextMessages);
    setInputMessage('');
    setIsLoading(true);

    // Dynamic loading messages based on user text
    const lower = userText.toLowerCase();
    if (lower.includes('weight') || lower.includes('heavy') || lower.includes('limit')) {
      setStatusMessage('Calculating bag weight...');
    } else if (lower.includes('add') || lower.includes('remove') || lower.includes('pack')) {
      setStatusMessage('Updating your packing list...');
    } else if (lower.includes('weather') || lower.includes('rain')) {
      setStatusMessage('Checking weather-based tips...');
    } else {
      setStatusMessage('Looking at your trip details...');
    }

    try {
      const { data: { session } } = await supabase().auth.getSession();
      if (!session?.access_token) throw new Error('Please log in to use BagBuddy AI.');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: userText.trim(),
          tripContext: {
            trip: currentTrip,
            packingList: currentPackingList,
          },
          history: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      let actionNote: string | undefined;

      // Handle backend action response
      if (data.action) {
        const { type, payload } = data.action;
        if (type === 'add_item' && payload?.item_name) {
          onAddItem({
            name: payload.item_name,
            category: payload.category || 'Other Essentials',
            quantity: payload.quantity || 1,
            weight: payload.weight || 0.25,
          });
          actionNote = `Added "${payload.item_name}" to ${payload.category || 'your list'}`;
        } else if (type === 'remove_item' && payload?.item_name) {
          const removed = onRemoveItem(payload.item_name);
          actionNote = removed
            ? `Removed "${payload.item_name}"`
            : `Could not find "${payload.item_name}" in your list`;
        } else if (type === 'toggle_packed' && payload?.item_name) {
          onTogglePacked(payload.item_name, payload.packed !== false);
          actionNote = `Marked "${payload.item_name}" as ${payload.packed !== false ? 'packed' : 'unpacked'}`;
        }
      }

      const assistantMsg: Message = {
        id: `ast_${Date.now()}`,
        role: 'assistant',
        content: data.reply || "I've checked your trip details!",
        actionSummary: actionNote,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      updateMessages([...nextMessages, assistantMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMsg: Message = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: "I'm having trouble connecting to the travel assistant right now. Your existing packing list is safe. Please try again shortly.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      updateMessages([...nextMessages, errorMsg]);
    } finally {
      setIsLoading(false);
      setStatusMessage(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputMessage);
    }
  };

  // Quick suggestion prompts
  const suggestionChips = currentTrip
    ? [
        'What should I pack?',
        'Check my bag weight',
        'What am I missing?',
        'Weather-based suggestions',
        'Help me pack lighter',
      ]
    : [
        'Help me plan a trip',
        'How does BagBuddy work?',
        'What are standard airline bag limits?',
      ];

  return (
    <>
      {/* Floating launcher button */}
      {!isOpen && (
        <button
          className="chatbot-launcher-btn"
          onClick={() => setIsOpen(true)}
          aria-label="Open BagBuddy AI Travel Assistant"
        >
          <span className="launcher-icon">🧳</span>
          <span className="launcher-text">Ask BagBuddy</span>
          <span className="launcher-badge">AI</span>
        </button>
      )}

      {/* Floating chat panel */}
      {isOpen && (
        <div className="chatbot-panel" role="dialog" aria-labelledby="chat-heading">
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-info">
              <span className="chat-avatar">🎒</span>
              <div>
                <h3 id="chat-heading">BagBuddy AI</h3>
                <p>Your personal travel &amp; packing assistant</p>
              </div>
            </div>
            <div className="chatbot-header-actions">
              <button
                className="chat-action-btn"
                onClick={handleClearChat}
                title="Clear conversation"
              >
                Clear
              </button>
              <button
                className="chat-close-btn"
                onClick={() => setIsOpen(false)}
                title="Minimize assistant"
                aria-label="Close assistant"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Active Trip Banner Indicator */}
          {currentTrip ? (
            <div className="chat-trip-badge">
              <span>📍 {currentTrip.destination}</span>
              <span>• {currentTrip.travel_mode}</span>
              <span>• Limit: {currentTrip.weight_limit} kg</span>
            </div>
          ) : (
            <div className="chat-trip-badge" style={{ justifyContent: 'space-between' }}>
              <span>✈️ No active trip selected</span>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate('setup');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    padding: 0,
                  }}
                >
                  Plan trip →
                </button>
              )}
            </div>
          )}

          {/* Messages list */}
          <div className="chatbot-messages">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`chat-message ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`}
              >
                <div className="message-bubble">
                  <p>{msg.content}</p>
                  {msg.actionSummary && (
                    <div className="action-pill">
                      <span>✓ {msg.actionSummary}</span>
                    </div>
                  )}
                  <span className="message-time">{msg.timestamp}</span>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="chat-message assistant-msg">
                <div className="message-bubble loading-bubble">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <small className="loading-status-text">
                    {statusMessage || 'Thinking...'}
                  </small>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestion Chips */}
          <div className="chat-suggestions-bar">
            {suggestionChips.map(chip => (
              <button
                key={chip}
                className="suggestion-chip"
                onClick={() => handleSendMessage(chip)}
                disabled={isLoading}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <form
            className="chatbot-input-bar"
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage(inputMessage);
            }}
          >
            <textarea
              className="chat-textarea"
              rows={1}
              placeholder="Ask about your trip or packing..."
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button
              type="submit"
              className="chat-send-btn"
              disabled={!inputMessage.trim() || isLoading}
              aria-label="Send message"
            >
              <span>Send</span>
              <span aria-hidden="true">↑</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
};
