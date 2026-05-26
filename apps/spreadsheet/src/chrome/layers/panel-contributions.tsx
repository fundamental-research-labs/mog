import { useSyncExternalStore } from 'react';
import type React from 'react';

export interface SpreadsheetPanelContribution {
  readonly id: string;
  readonly order?: number;
  readonly Component: React.ComponentType;
}

const contributions = new Map<string, SpreadsheetPanelContribution>();
const listeners = new Set<() => void>();

let snapshot: readonly SpreadsheetPanelContribution[] = [];

function rebuildSnapshot(): void {
  snapshot = Array.from(contributions.values()).sort((a, b) => {
    const orderDelta = (a.order ?? 0) - (b.order ?? 0);
    return orderDelta === 0 ? a.id.localeCompare(b.id) : orderDelta;
  });
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly SpreadsheetPanelContribution[] {
  return snapshot;
}

export function registerSpreadsheetPanelContribution(
  contribution: SpreadsheetPanelContribution,
): () => void {
  contributions.set(contribution.id, contribution);
  rebuildSnapshot();
  emit();

  return () => {
    if (contributions.get(contribution.id) !== contribution) return;
    contributions.delete(contribution.id);
    rebuildSnapshot();
    emit();
  };
}

export function useSpreadsheetPanelContributions(): readonly SpreadsheetPanelContribution[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
