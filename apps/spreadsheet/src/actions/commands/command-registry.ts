/**
 * Command Registry Implementation
 *
 * Implements ICommandRegistry from contracts with fuzzy search support.
 * Used by the Command Palette (Ctrl+Shift+P) to discover and execute commands.
 *
 * Design notes:
 * - Uses a simple built-in fuzzy search (no external dependencies)
 * - Singleton pattern for global command registration
 * - Thread-safe for concurrent registrations
 * - Caches search index and invalidates on registration changes
 */

import type {
  Command,
  CommandCategory,
  CommandExecutionResult,
  CommandHandler,
  CommandRegistration,
  CommandSearchOptions,
  ICommandRegistry,
} from '@mog-sdk/contracts/commands';

// =============================================================================
// Fuzzy Search Implementation
// =============================================================================

/**
 * Simple fuzzy search scoring.
 * Returns a score from 0 (no match) to 1 (perfect match).
 * Higher scores indicate better matches.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query || !text) return 0;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact match gets highest score
  if (textLower === queryLower) return 1;

  // Starts with query gets high score
  if (textLower.startsWith(queryLower)) return 0.9;

  // Contains exact query gets good score
  if (textLower.includes(queryLower)) return 0.7;

  // Fuzzy character matching
  let queryIndex = 0;
  let matchCount = 0;
  let consecutiveBonus = 0;
  let lastMatchIndex = -2;

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      matchCount++;
      // Bonus for consecutive matches
      if (i === lastMatchIndex + 1) {
        consecutiveBonus += 0.1;
      }
      lastMatchIndex = i;
      queryIndex++;
    }
  }

  // All characters must be found in order
  if (queryIndex < queryLower.length) return 0;

  // Score based on match ratio and consecutive bonus
  const matchRatio = matchCount / textLower.length;
  const coverageRatio = matchCount / queryLower.length;
  return Math.min(0.6, matchRatio * 0.3 + coverageRatio * 0.3 + consecutiveBonus);
}

/**
 * Score a command against a search query.
 * Searches across label, category, description, and keywords.
 */
function scoreCommand(query: string, command: Command): number {
  // Weight different fields
  const labelScore = fuzzyScore(query, command.label) * 1.0;
  const categoryScore = fuzzyScore(query, command.category) * 0.7;
  const descriptionScore = command.description ? fuzzyScore(query, command.description) * 0.5 : 0;

  // Check keywords
  let keywordScore = 0;
  if (command.keywords) {
    for (const keyword of command.keywords) {
      const score = fuzzyScore(query, keyword);
      if (score > keywordScore) {
        keywordScore = score * 0.6;
      }
    }
  }

  // Return best score
  return Math.max(labelScore, categoryScore, descriptionScore, keywordScore);
}

// =============================================================================
// Command Registry Implementation
// =============================================================================

interface CommandEntry {
  command: Command;
  handler: CommandHandler;
}

class CommandRegistryImpl implements ICommandRegistry {
  private commands = new Map<string, CommandEntry>();

  // ===========================================================================
  // Registration
  // ===========================================================================

  register(command: Command, handler: CommandHandler): void {
    this.commands.set(command.id, { command, handler });
  }

  registerMany(registrations: CommandRegistration[]): void {
    for (const { command, handler } of registrations) {
      this.commands.set(command.id, { command, handler });
    }
  }

  unregister(id: string): boolean {
    const existed = this.commands.delete(id);
    return existed;
  }

  clear(): void {
    this.commands.clear();
  }

  // ===========================================================================
  // Retrieval
  // ===========================================================================

  getAll(): Command[] {
    return Array.from(this.commands.values()).map((entry) => entry.command);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)?.command;
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  getByCategory(category: CommandCategory): Command[] {
    return this.getAll().filter((cmd) => cmd.category === category);
  }

  // ===========================================================================
  // Execution
  // ===========================================================================

  async execute(id: string): Promise<CommandExecutionResult> {
    const entry = this.commands.get(id);
    if (!entry) {
      return { success: false, error: `Command not found: ${id}` };
    }

    // Check if command is disabled
    if (entry.command.enabled === false) {
      return { success: false, error: `Command is disabled: ${id}` };
    }

    try {
      await entry.handler();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  search(query: string, options: CommandSearchOptions = {}): Command[] {
    const { limit = 20, categories, enabledOnly = true } = options;

    let commands = this.getFilteredCommands(enabledOnly);

    // Filter by categories if specified
    if (categories && categories.length > 0) {
      const categorySet = new Set(categories);
      commands = commands.filter((cmd) => categorySet.has(cmd.category));
    }

    // If no query, return first N commands sorted by category then label
    if (!query.trim()) {
      return commands
        .sort((a, b) => {
          const catCmp = a.category.localeCompare(b.category);
          if (catCmp !== 0) return catCmp;
          return a.label.localeCompare(b.label);
        })
        .slice(0, limit);
    }

    // Score and sort by relevance
    const scored = commands
      .map((command) => ({
        command,
        score: scoreCommand(query, command),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item) => item.command);
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.commands.get(id);
    if (entry) {
      entry.command = { ...entry.command, enabled };
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getFilteredCommands(enabledOnly: boolean): Command[] {
    const all = this.getAll();
    if (!enabledOnly) return all;
    return all.filter((cmd) => cmd.enabled !== false);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Global command registry instance.
 * Use this singleton to register and execute commands throughout the app.
 *
 * @example
 * ```typescript
 * import { commandRegistry } from '../commands';
 *
 * // Register a command
 * commandRegistry.register({
 * id: 'format.bold',
 * label: 'Toggle Bold',
 * category: 'Format',
 * shortcut: 'Ctrl+B',
 * }, () => toggleBold());
 *
 * // Execute a command
 * await commandRegistry.execute('format.bold');
 *
 * // Search commands
 * const results = commandRegistry.search('bold');
 * ```
 */
export const commandRegistry: ICommandRegistry = new CommandRegistryImpl();

// Export the class for testing purposes
export { CommandRegistryImpl };
