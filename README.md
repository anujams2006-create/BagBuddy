# BagBuddy 🎒

> **Pack smarter. Travel lighter.**
> Your personalized travel packing assistant and luggage weight checker for vacations, family trips, road trips, and hostel shifting.

## Overview
BagBuddy is a React application built with TypeScript and Vite. It generates personalized, categorized packing checklists tailored to your destination, travel duration, transport mode, travel profile, planned activities, and luggage limits. It keeps your luggage within weight limits before you leave home.

## Features
- **Smart Trip Planning**: 6-step guided wizard for destination, dates, travel mode (Flight, Train, Bus, Car, Hostel), trip type, profile (Female, Male, Other), travelers & children count, activities, bag type, and bag weight limits.
- **Dynamic Packing Engine**: Calculates exact clothes quantities, toiletries, accessories, electronics, documents, activity-specific gear, and hostel shift necessities based on duration and traveler profiles.
- **Weight Limit Tracking & Overload Warnings**: Real-time comparison of estimated baggage weight versus airline or transport baggage allowances with recommendations for items to leave behind when overloaded.
- **Interactive Packing Checklist**: Progress tracking with percentage indicator, item check-off with strikethrough styling, custom item additions, and removal options.
- **Itinerary Management**: Save multiple trips, view past and upcoming checklists, and manage itineraries.
- **Account & Session Management**: Sign up, log in, demo account switcher, and persistent local storage.

## Tech Stack
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailored CSS with DM Sans typography and responsive design
- **State & Storage**: Client-side localStorage persistence
