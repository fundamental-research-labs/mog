/**
 * File Icons - Icon mapping and FileIcon component for file explorer
 *
 * Provides VS Code-style file type icons using react-icons.
 * Extracted from FileTreeItem.tsx to:
 * 1. Reduce FileTreeItem complexity
 * 2. Make icon configuration easily maintainable
 * 3. Allow reuse in other components (tabs, breadcrumbs, etc.)
 *
 * Uses text-ss-text-secondary color which adapts to light/dark mode.
 */

import { cn } from '../ui/radix/styles';

// React-icons imports for file type icons
import type { IconType } from 'react-icons';
import {
  SiC,
  SiCplusplus,
  SiCss3,
  SiDocker,
  SiGit,
  SiGnubash,
  SiGo,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiKotlin,
  SiMarkdown,
  SiPhp,
  SiPython,
  SiRuby,
  SiRust,
  SiSass,
  SiSwift,
  SiTypescript,
  SiYaml,
} from 'react-icons/si';
import { VscFile, VscFileCode, VscFileMedia, VscFilePdf, VscTable } from 'react-icons/vsc';

// =============================================================================
// Icon Configuration
// =============================================================================

/** File icon configuration: maps extension to icon component and color */
type FileIconConfig = {
  icon: IconType;
  color: string;
};

// Use CSS variable for icon color (matches text-ss-text-secondary)
// This allows the color to adapt to light/dark mode
const ICON_COLOR = 'currentColor';

/** Map of file extensions to their icon configurations */
export const FILE_ICON_MAP: Record<string, FileIconConfig> = {
  // TypeScript/JavaScript
  ts: { icon: SiTypescript, color: ICON_COLOR },
  tsx: { icon: SiTypescript, color: ICON_COLOR },
  js: { icon: SiJavascript, color: ICON_COLOR },
  jsx: { icon: SiJavascript, color: ICON_COLOR },
  mjs: { icon: SiJavascript, color: ICON_COLOR },
  cjs: { icon: SiJavascript, color: ICON_COLOR },

  // Python
  py: { icon: SiPython, color: ICON_COLOR },
  pyw: { icon: SiPython, color: ICON_COLOR },

  // Systems languages
  rs: { icon: SiRust, color: ICON_COLOR },
  go: { icon: SiGo, color: ICON_COLOR },
  c: { icon: SiC, color: ICON_COLOR },
  h: { icon: SiC, color: ICON_COLOR },
  cpp: { icon: SiCplusplus, color: ICON_COLOR },
  hpp: { icon: SiCplusplus, color: ICON_COLOR },
  cc: { icon: SiCplusplus, color: ICON_COLOR },

  // Mobile/Other languages
  swift: { icon: SiSwift, color: ICON_COLOR },
  kt: { icon: SiKotlin, color: ICON_COLOR },
  rb: { icon: SiRuby, color: ICON_COLOR },
  php: { icon: SiPhp, color: ICON_COLOR },

  // Web
  html: { icon: SiHtml5, color: ICON_COLOR },
  htm: { icon: SiHtml5, color: ICON_COLOR },
  css: { icon: SiCss3, color: ICON_COLOR },
  scss: { icon: SiSass, color: ICON_COLOR },
  sass: { icon: SiSass, color: ICON_COLOR },
  less: { icon: SiCss3, color: ICON_COLOR },

  // Data formats
  json: { icon: SiJson, color: ICON_COLOR },
  jsonc: { icon: SiJson, color: ICON_COLOR },
  yaml: { icon: SiYaml, color: ICON_COLOR },
  yml: { icon: SiYaml, color: ICON_COLOR },

  // Markdown
  md: { icon: SiMarkdown, color: ICON_COLOR },
  mdx: { icon: SiMarkdown, color: ICON_COLOR },

  // Shell/Config
  sh: { icon: SiGnubash, color: ICON_COLOR },
  bash: { icon: SiGnubash, color: ICON_COLOR },
  zsh: { icon: SiGnubash, color: ICON_COLOR },

  // Git
  gitignore: { icon: SiGit, color: ICON_COLOR },
  gitattributes: { icon: SiGit, color: ICON_COLOR },

  // Docker
  dockerfile: { icon: SiDocker, color: ICON_COLOR },

  // Spreadsheets
  xlsx: { icon: VscTable, color: ICON_COLOR },
  xls: { icon: VscTable, color: ICON_COLOR },
  csv: { icon: VscTable, color: ICON_COLOR },

  // PDF
  pdf: { icon: VscFilePdf, color: ICON_COLOR },

  // Images
  png: { icon: VscFileMedia, color: ICON_COLOR },
  jpg: { icon: VscFileMedia, color: ICON_COLOR },
  jpeg: { icon: VscFileMedia, color: ICON_COLOR },
  gif: { icon: VscFileMedia, color: ICON_COLOR },
  svg: { icon: VscFileMedia, color: ICON_COLOR },
  webp: { icon: VscFileMedia, color: ICON_COLOR },
  ico: { icon: VscFileMedia, color: ICON_COLOR },
};

/** Default icon for unknown file types */
const DEFAULT_FILE_ICON: FileIconConfig = { icon: VscFile, color: 'currentColor' };

/** Icon for code-like files without specific icons */
const CODE_FILE_ICON: FileIconConfig = { icon: VscFileCode, color: 'currentColor' };

/** Extensions that should use the code icon as fallback */
export const CODE_EXTENSIONS = new Set([
  'java',
  'scala',
  'clj',
  'erl',
  'ex',
  'lua',
  'r',
  'pl',
  'sql',
  'graphql',
  'gql',
  'xml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
]);

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get the file extension from a filename.
 *
 * @param filename - The filename to extract extension from
 * @returns The lowercase extension without the dot, or undefined if none
 */
export function getFileExtension(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return undefined;
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Get filename without extension (for rename input).
 *
 * @param filename - The filename to strip extension from
 * @returns The filename without its extension
 */
export function getNameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.substring(0, lastDot) : filename;
}

// =============================================================================
// FileIcon Component
// =============================================================================

export interface FileIconProps {
  /** The filename to determine icon for */
  filename: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * File icon component using react-icons.
 * Shows colored icons for known file types, generic icon for unknown.
 * Uses text-ss-text-secondary color which adapts to light/dark mode.
 */
export function FileIcon({ filename, className }: FileIconProps) {
  const ext = getFileExtension(filename);

  // Special case: dotfiles like .gitignore
  if (!ext && filename.startsWith('.')) {
    const dotfileName = filename.substring(1).toLowerCase();
    if (dotfileName === 'gitignore' || dotfileName === 'gitattributes') {
      const config = FILE_ICON_MAP['gitignore'];
      const Icon = config.icon;
      return <Icon className={cn('text-ss-text-secondary h-4 w-4 shrink-0', className)} />;
    }
  }

  // Look up icon config
  let config = ext ? FILE_ICON_MAP[ext] : undefined;

  // Fallback to code icon for code-like extensions
  if (!config && ext && CODE_EXTENSIONS.has(ext)) {
    config = CODE_FILE_ICON;
  }

  // Final fallback
  if (!config) {
    config = DEFAULT_FILE_ICON;
  }

  const Icon = config.icon;
  return <Icon className={cn('text-ss-text-secondary h-4 w-4 shrink-0', className)} />;
}

// Re-export VscFile for empty state display in FileTree
export { VscFile };
