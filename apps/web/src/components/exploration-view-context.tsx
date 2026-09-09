'use client';
import { createContext, useContext } from 'react';
import type { ExplorationViewState } from '@/lib/exploration-view-state';
export const ExplorationViewContext =
  createContext<ExplorationViewState | null>(null);
export const useExplorationViewState = () => useContext(ExplorationViewContext);
