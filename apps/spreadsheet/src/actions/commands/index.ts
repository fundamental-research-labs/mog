/**
 * Command Registry Module
 *
 * Provides the command registry for the Command Palette feature.
 * This module enables:
 * - Registration of commands with handlers
 * - Fuzzy search across command labels, categories, and keywords
 * - Command execution by ID
 *
 * @example
 * ```typescript
 * import { commandRegistry, registerBuiltInCommands } from '../commands';
 *
 * // Register custom command
 * commandRegistry.register({
 * id: 'custom.action',
 * label: 'My Custom Action',
 * category: 'Custom',
 * }, () => doCustomAction());
 *
 * // Search commands
 * const results = commandRegistry.search('bold');
 *
 * // Execute command
 * await commandRegistry.execute('format.bold');
 * ```
 */

// Registry singleton
export { CommandRegistryImpl, commandRegistry } from './command-registry';

// Built-in commands registration
export {
  getRegisteredBuiltInCommandIds,
  registerBuiltInCommands,
  unregisterBuiltInCommands,
  type CommandActions,
} from './built-in-commands';
