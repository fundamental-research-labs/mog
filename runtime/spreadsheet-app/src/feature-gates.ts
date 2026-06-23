import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';

import type {
  HostCommandOwner,
  CommandBarTabId,
  MogSpreadsheetChromePolicy,
  MogSpreadsheetCommandPolicy,
  MogSpreadsheetFeaturePolicy,
  SpreadsheetCommandRequest,
  SpreadsheetEditLevel,
  SpreadsheetResolvedActor,
} from './public-types';

type SpreadsheetFeatureGateProps = {
  readonly commands?: MogSpreadsheetCommandPolicy;
  readonly host?: {
    readonly persistenceMode?: 'host-owned-ephemeral' | 'host-owned-persistent' | 'local-recovery';
  };
  readonly onSaveRequest?: unknown;
  readonly onCommandRequest?: unknown;
};

type SpreadsheetEditModelPolicy = {
  readonly user?: SpreadsheetEditLevel;
  readonly agents?: SpreadsheetEditLevel;
  readonly automation?: SpreadsheetEditLevel;
};

type SpreadsheetRuntimeFeatureAvailability = {
  readonly versionControl?: boolean;
};

const ALL_COMMAND_BAR_TABS: readonly CommandBarTabId[] = [
  'home',
  'insert',
  'draw',
  'page',
  'formulas',
  'data',
  'review',
  'view',
];

export function mergeFeatureGates(
  base: MogSpreadsheetFeaturePolicy | undefined,
  chrome: MogSpreadsheetChromePolicy | undefined,
  commands: MogSpreadsheetCommandPolicy | undefined,
  editModel: SpreadsheetEditModelPolicy | undefined,
  runtimeAvailability: SpreadsheetRuntimeFeatureAvailability = {},
): FeatureGates {
  const next: FeatureGates = {
    ...(base as FeatureGates | undefined),
    tabs: { ...(base?.tabs as FeatureGates['tabs'] | undefined) },
    groups: { ...(base?.groups as FeatureGates['groups'] | undefined) },
    capabilities: { ...(base?.capabilities as FeatureGates['capabilities'] | undefined) },
    ribbonVisibility: base?.ribbonVisibility,
  };

  if (base?.commandBar === false) {
    next.ribbon = false;
  }

  const commandBar = chrome?.commandBar;
  if (commandBar === false || (typeof commandBar === 'object' && commandBar.mode === 'hidden')) {
    next.ribbon = false;
  }

  if (typeof commandBar === 'object') {
    const visibleTabs = commandBar.tabs ? new Set<CommandBarTabId>(commandBar.tabs) : null;
    const hiddenTabs = new Set<CommandBarTabId>(commandBar.hiddenTabs ?? []);
    for (const tab of ALL_COMMAND_BAR_TABS) {
      if ((visibleTabs && !visibleTabs.has(tab)) || hiddenTabs.has(tab)) {
        next.tabs![tab] = false;
      }
    }

    for (const group of commandBar.hiddenGroups ?? []) {
      next.groups![group as keyof NonNullable<FeatureGates['groups']>] = false;
    }

    for (const command of commandBar.disabledCommands ?? []) {
      next.capabilities![command as keyof NonNullable<FeatureGates['capabilities']>] = false;
    }
  }

  if (chrome?.formulaBar === false) next.capabilities!.formulaBar = false;
  if (chrome?.fileMenu === false) next.capabilities!.fileMenu = false;
  if (chrome?.sheetTabs === false) next.capabilities!.sheetTabs = false;
  if (chrome?.statusBar === false) {
    (next.capabilities as Record<string, boolean>).statusBar = false;
  }
  if (runtimeAvailability.versionControl !== true) {
    next.capabilities!.versionControl = false;
    next.capabilities!.versionControlMerge = false;
    next.capabilities!['versionControl.merge'] = false;
  }

  if (editModel?.user === 'none' || editModel?.user === 'read') {
    next.editing = false;
  }

  const commandKeys: Array<keyof MogSpreadsheetCommandPolicy> = [
    'save',
    'export',
    'print',
    'open',
    'import',
    'share',
  ];
  for (const key of commandKeys) {
    if (commands?.[key] === 'disabled') {
      next.capabilities![key as keyof NonNullable<FeatureGates['capabilities']>] = false;
    }
  }

  return next;
}

export function resolveCommandOwner(
  props: SpreadsheetFeatureGateProps,
  command: SpreadsheetCommandRequest['command'],
): HostCommandOwner {
  const explicit = props.commands?.[command];
  if (explicit) return explicit;
  if (props.host?.persistenceMode === 'host-owned-ephemeral') return 'host';
  if (props.host?.persistenceMode === 'local-recovery') return 'mog';
  if (command === 'save' && props.onSaveRequest) return 'host';
  if (props.onCommandRequest) return 'host';
  return 'mog';
}

export function actorEditLevel(
  editModel: SpreadsheetEditModelPolicy | undefined,
  actor: SpreadsheetResolvedActor,
): SpreadsheetEditLevel | undefined {
  if (actor.kind === 'agent') return editModel?.agents;
  if (actor.kind === 'automation' || actor.kind === 'system') return editModel?.automation;
  return editModel?.user;
}
