import type {
  CapturePolicy,
  SemanticDomainClass,
  VersionOperationKind,
  VersionWriteAdmissionMode,
} from '@mog-sdk/contracts/versioning';

export type OperationInvocationKind =
  | 'public-mutation'
  | 'public-ui-state'
  | 'system-mutation'
  | 'undo-redo-control'
  | 'lifecycle'
  | 'direct-compute-api';

export interface OperationAdmissionClassification {
  readonly command: string;
  readonly invocation: OperationInvocationKind;
  readonly operationKind: VersionOperationKind;
  readonly domainClass: SemanticDomainClass;
  readonly capturePolicy: CapturePolicy;
  readonly writeAdmissionMode: VersionWriteAdmissionMode;
  readonly rationale: string;
}

type ClassificationTemplate = Omit<OperationAdmissionClassification, 'command'>;

const ROOT_CREATION_COMMANDS = new Set([
  'compute_init',
  'compute_init_from_yrs_state',
  'compute_create_default_sheet_with_default_col_width',
]);

const LIFECYCLE_EXCLUDED_COMMANDS = new Set([
  'compute_destroy',
  'compute_register_viewport',
  'compute_unregister_viewport',
]);

const SYNC_EXCLUDED_COMMANDS = new Set([
  'compute_apply_sync_update',
  'compute_complete_deferred_hydration',
  'compute_flush_undo_capture',
  'compute_import_from_csv_bytes',
  'compute_import_from_xlsx_bytes',
  'compute_import_from_xlsx_bytes_deferred',
  'compute_import_sheets_from_xlsx',
  'compute_settle_for_mirror',
]);

const UNDO_REDO_COMMANDS = new Set([
  'compute_begin_undo_group',
  'compute_end_undo_group',
  'compute_redo',
  'compute_undo',
]);

const DERIVED_ONLY_COMMANDS = new Set([
  'compute_auto_fit_column_and_set',
  'compute_auto_fit_columns_and_set',
  'compute_auto_fit_rows_and_set',
  'compute_pivot_materialize',
  'compute_pivot_materialize_mutation',
  'compute_pivot_register_def',
  'compute_pivot_unregister_def',
]);

const SHADOW_ONLY_EXACT_COMMANDS = new Set([
  'compute_patch_workbook_settings',
  'compute_reset_sheet_viewports',
  'compute_set_current_time',
  'compute_set_custom_setting',
  'compute_set_format_for_ranges_ui_state',
  'compute_set_scroll_position',
  'compute_set_view_option',
  'compute_update_viewport_bounds',
]);

const BLOCKED_SECRET_PREFIXES = ['compute_wb_security_'];

const SHADOW_ONLY_PREFIXES = [
  'compute_set_calculation',
  'compute_set_convergence',
  'compute_set_default_',
  'compute_set_frozen_panes',
  'compute_set_iterative_calculation',
  'compute_set_max_iterations',
  'compute_set_sheet_enable_calculation',
  'compute_set_sheet_hidden',
  'compute_set_sheet_setting',
  'compute_set_sheet_visibility',
  'compute_set_split_config',
  'compute_set_use_precision_as_displayed',
  'compute_update_refresh_metadata',
];

function hasAnyPrefix(command: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => command.startsWith(prefix));
}

function withCommand(
  command: string,
  template: ClassificationTemplate,
): OperationAdmissionClassification {
  return { command, ...template };
}

export function classifyWriteOperation(
  command: string,
  invocationHint?: OperationInvocationKind,
): OperationAdmissionClassification | null {
  if (ROOT_CREATION_COMMANDS.has(command)) {
    return withCommand(command, {
      invocation: 'lifecycle',
      operationKind: 'mutation',
      domainClass: 'authored',
      capturePolicy: 'rootCreation',
      writeAdmissionMode: 'capture',
      rationale: 'Creates the initial version-history root for a workbook engine instance.',
    });
  }

  if (LIFECYCLE_EXCLUDED_COMMANDS.has(command)) {
    return withCommand(command, {
      invocation: 'lifecycle',
      operationKind: 'mutation',
      domainClass: 'transient',
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      rationale: 'Lifecycle resource management is not user history.',
    });
  }

  if (SYNC_EXCLUDED_COMMANDS.has(command)) {
    return withCommand(command, {
      invocation: 'system-mutation',
      operationKind: command === 'compute_apply_sync_update' ? 'sync-import' : 'mutation',
      domainClass: 'external',
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      rationale:
        'Provider/import replay must remain observable but is not captured as authored history.',
    });
  }

  if (UNDO_REDO_COMMANDS.has(command)) {
    return withCommand(command, {
      invocation: 'undo-redo-control',
      operationKind:
        command === 'compute_undo' || command === 'compute_redo' ? 'revert' : 'mutation',
      domainClass: 'authored',
      capturePolicy: 'historyGap',
      writeAdmissionMode: 'captureSuspendedWithGap',
      rationale:
        'Undo/redo changes history position and must not be captured as a new forward edit.',
    });
  }

  if (DERIVED_ONLY_COMMANDS.has(command)) {
    return withCommand(command, {
      invocation: invocationHint ?? 'public-mutation',
      operationKind: 'derived-output-promotion',
      domainClass: 'derived',
      capturePolicy: 'derivedOnly',
      writeAdmissionMode: 'shadowOnly',
      rationale:
        'Materialized or derived outputs are attributable to source data, not authored directly.',
    });
  }

  if (SHADOW_ONLY_EXACT_COMMANDS.has(command) || hasAnyPrefix(command, SHADOW_ONLY_PREFIXES)) {
    return withCommand(command, {
      invocation: invocationHint ?? 'public-ui-state',
      operationKind: 'mutation',
      domainClass: 'transient',
      capturePolicy: 'shadowOnly',
      writeAdmissionMode: 'shadowOnly',
      rationale: 'Runtime, viewport, or control-plane state is observed in shadow mode only.',
    });
  }

  if (hasAnyPrefix(command, BLOCKED_SECRET_PREFIXES)) {
    return withCommand(command, {
      invocation: 'direct-compute-api',
      operationKind: 'mutation',
      domainClass: 'secret',
      capturePolicy: 'excluded',
      writeAdmissionMode: 'block',
      rationale:
        'Security-policy mutation payloads are not admitted to version capture in this slice.',
    });
  }

  if (
    command.startsWith('compute_') ||
    command.startsWith('chart_') ||
    command.startsWith('table_')
  ) {
    return withCommand(command, {
      invocation: invocationHint ?? 'public-mutation',
      operationKind: 'mutation',
      domainClass: 'authored',
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      rationale: 'Default generated/native compute write; captured as authored workbook mutation.',
    });
  }

  return null;
}
