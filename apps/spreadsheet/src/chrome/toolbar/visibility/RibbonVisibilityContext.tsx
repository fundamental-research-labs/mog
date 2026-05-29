import type { ReactNode } from 'react';
import React, { createContext, useContext, useMemo } from 'react';

import type {
  RibbonVisibilityConfig,
  RibbonVisibilityPath,
  RibbonVisibilityTabKey,
} from '@mog-sdk/contracts/ribbon';
import { isRibbonPathVisible, normalizeRibbonVisibilityKey } from '@mog-sdk/contracts/ribbon';
import { useFeatureGates } from '../../../infra/context/feature-gates-context';

type RibbonVisibilityScope = {
  tab: RibbonVisibilityTabKey | null;
  group: string | null;
};

const RibbonVisibilityScopeContext = createContext<RibbonVisibilityScope>({
  tab: null,
  group: null,
});

export function RibbonVisibilityTab({
  tab,
  children,
}: {
  tab: RibbonVisibilityTabKey;
  children: ReactNode;
}) {
  const value = useMemo<RibbonVisibilityScope>(() => ({ tab, group: null }), [tab]);
  return (
    <RibbonVisibilityScopeContext.Provider value={value}>
      {children}
    </RibbonVisibilityScopeContext.Provider>
  );
}

export function RibbonVisibilityGroup({ group, children }: { group: string; children: ReactNode }) {
  const parent = useContext(RibbonVisibilityScopeContext);
  const value = useMemo<RibbonVisibilityScope>(
    () => ({ tab: parent.tab, group }),
    [group, parent.tab],
  );
  return (
    <RibbonVisibilityScopeContext.Provider value={value}>
      {children}
    </RibbonVisibilityScopeContext.Provider>
  );
}

export function useRibbonGroupVisibility(
  label: string,
  explicitKey?: string,
): {
  groupKey: string;
  visible: boolean;
} {
  const gates = useFeatureGates();
  const scope = useContext(RibbonVisibilityScopeContext);
  const groupKey = explicitKey ?? normalizeRibbonVisibilityKey(label) ?? label;
  if (!scope.tab) return { groupKey, visible: true };
  return {
    groupKey,
    visible: isRibbonPathVisible(gates.ribbonVisibility, [scope.tab, groupKey]),
  };
}

export function useRibbonButtonVisible(input: {
  visibilityKey?: string;
  label?: string;
  testId?: string;
  title?: string;
  ariaLabel?: string;
}): boolean {
  const gates = useFeatureGates();
  const scope = useContext(RibbonVisibilityScopeContext);
  if (!scope.tab || !scope.group) return true;
  const buttonKey = resolveButtonKey(input);
  if (!buttonKey) return true;
  return isRibbonPathVisible(gates.ribbonVisibility, [scope.tab, scope.group, buttonKey]);
}

export function RibbonVisibilityItem({ item, children }: { item: string; children: ReactNode }) {
  const visible = useRibbonButtonVisible({ visibilityKey: item });
  return visible ? <>{children}</> : null;
}

export function useRibbonVisibilityPathVisible(path: RibbonVisibilityPath): boolean {
  const gates = useFeatureGates();
  return isRibbonPathVisible(gates.ribbonVisibility, path);
}

export function RibbonVisibilityPathItem({
  path,
  children,
}: {
  path: RibbonVisibilityPath;
  children: ReactNode;
}) {
  const visible = useRibbonVisibilityPathVisible(path);
  return visible ? <>{children}</> : null;
}

function resolveButtonKey(input: {
  visibilityKey?: string;
  label?: string;
  testId?: string;
  title?: string;
  ariaLabel?: string;
}): string | null {
  return (
    input.visibilityKey ??
    normalizeRibbonVisibilityKey(input.testId) ??
    normalizeRibbonVisibilityKey(input.label) ??
    normalizeRibbonVisibilityKey(input.title) ??
    normalizeRibbonVisibilityKey(input.ariaLabel)
  );
}

export function isRibbonTabVisible(
  config: RibbonVisibilityConfig | undefined,
  tab: RibbonVisibilityTabKey,
): boolean {
  return isRibbonPathVisible(config, [tab]);
}
