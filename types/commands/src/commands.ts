/**
 * Command Palette Contracts
 *
 * Type definitions for the command registry and command palette.
 * These interfaces enable a VSCode-style command palette for
 * executing actions via keyboard or search.
 */

// ============================================================================
// Command Types
// ============================================================================

/**
 * A command that can be executed from the Command Palette.
 * Commands represent any action the user can perform in the spreadsheet.
 */
export interface Command {
  /** Unique identifier (e.g., 'cell.format.bold', 'edit.copy') */
  id: string;

  /** Display label shown in the palette (e.g., 'Toggle Bold') */
  label: string;

  /** Category for grouping (e.g., 'Format', 'Edit', 'View') */
  category: CommandCategory;

  /** Optional keyboard shortcut display (e.g., 'Ctrl+B', 'Cmd+Shift+P') */
  shortcut?: string;

  /** Optional icon identifier for visual display */
  icon?: string;

  /** Optional description for tooltip or detail view */
  description?: string;

  /** Optional tags for enhanced search (e.g., ['style', 'font', 'weight']) */
  keywords?: string[];

  /** Whether the command is currently enabled (default: true) */
  enabled?: boolean;
}

/**
 * Standard command categories for organization.
 */
export type CommandCategory =
  | 'Edit'
  | 'View'
  | 'Format'
  | 'Insert'
  | 'Data'
  | 'Formulas'
  | 'Review'
  | 'Help'
  | 'File'
  | 'Navigation'
  | 'Selection'
  | 'Custom';

// ============================================================================
// Command Registry Interface
// ============================================================================

/**
 * Command handler function signature.
 * Commands may be async for operations that need to await results.
 */
export type CommandHandler = () => void | Promise<void>;

/**
 * Command registration entry combining command metadata with handler.
 */
export interface CommandRegistration {
  command: Command;
  handler: CommandHandler;
}

/**
 * Search options for filtering commands.
 */
export interface CommandSearchOptions {
  /** Maximum number of results to return */
  limit?: number;

  /** Filter to specific categories */
  categories?: CommandCategory[];

  /** Only return enabled commands (default: true) */
  enabledOnly?: boolean;
}

/**
 * Result of a command execution.
 */
export type CommandExecutionResult = { success: true } | { success: false; error: string };

/**
 * Command registry interface for managing available commands.
 *
 * The registry is the central store for all commands in the application.
 * It supports:
 * - Registration/unregistration of commands
 * - Fuzzy search by label, category, description, and keywords
 * - Command execution by ID
 *
 * Implementation note: The registry should use a fuzzy search library
 * (e.g., Fuse.js) for matching user queries.
 */
export interface ICommandRegistry {
  /**
   * Register a command with its handler.
   * If a command with the same ID exists, it will be replaced.
   */
  register(command: Command, handler: CommandHandler): void;

  /**
   * Register multiple commands at once.
   */
  registerMany(registrations: CommandRegistration[]): void;

  /**
   * Unregister a command by ID.
   * Returns true if the command was found and removed.
   */
  unregister(id: string): boolean;

  /**
   * Get all registered commands.
   */
  getAll(): Command[];

  /**
   * Get a specific command by ID.
   */
  get(id: string): Command | undefined;

  /**
   * Execute a command by ID.
   * Returns execution result indicating success or failure.
   */
  execute(id: string): Promise<CommandExecutionResult>;

  /**
   * Search commands by query string.
   * Performs fuzzy matching on label, category, description, and keywords.
   */
  search(query: string, options?: CommandSearchOptions): Command[];

  /**
   * Get commands by category.
   */
  getByCategory(category: CommandCategory): Command[];

  /**
   * Check if a command is registered.
   */
  has(id: string): boolean;

  /**
   * Update a command's enabled state.
   */
  setEnabled(id: string, enabled: boolean): void;

  /**
   * Clear all registered commands.
   * Primarily for testing purposes.
   */
  clear(): void;
}

// ============================================================================
// Command Palette State Types
// ============================================================================

/**
 * State for the command palette UI component.
 * This can be stored in UIStore.
 */
export interface CommandPaletteState {
  /** Whether the palette is currently open */
  isOpen: boolean;

  /** Current search query */
  query: string;

  /** Index of the currently highlighted result */
  selectedIndex: number;

  /** Recent command IDs for quick access */
  recentCommands: string[];
}
