/**
 * Form Field Types
 *
 * Kernel-agnostic types for form field components.
 */

import type { UiCellValue } from '../types';

/**
 * Base props shared by all field components.
 */
export interface BaseFieldProps {
  /** Field value */
  value: UiCellValue;
  /** Change handler */
  onChange: (value: UiCellValue) => void;
  /** Whether field is disabled */
  disabled?: boolean;
  /** Error message */
  error?: string | null;
  /** Field label */
  label: string;
  /** Whether field is required */
  required?: boolean;
  /** Field ID (for form controls) */
  fieldId?: string;
}

/**
 * Text field specific props.
 */
export interface TextFieldProps extends BaseFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Whether to render as multiline textarea */
  multiline?: boolean;
  /** Number of rows for multiline */
  rows?: number;
  /** Input type (text, email, url, tel) */
  type?: 'text' | 'email' | 'url' | 'tel';
}

/**
 * Number field specific props.
 */
export interface NumberFieldProps extends BaseFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
}

/**
 * Date field specific props.
 */
export interface DateFieldProps extends BaseFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Whether to include time input */
  includeTime?: boolean;
}

/**
 * Checkbox field specific props.
 */
export interface CheckboxFieldProps extends BaseFieldProps {
  // No additional props needed
}

/**
 * Select option.
 */
export interface SelectOption {
  /** Option value */
  value: string;
  /** Display label */
  label: string;
  /** Optional color for the option */
  color?: string;
}

/**
 * Select field specific props.
 */
export interface SelectFieldProps extends BaseFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Available options */
  options: SelectOption[];
}

/**
 * Person option.
 */
export interface PersonOption {
  /** User ID */
  id: string;
  /** Display name */
  name: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Email address */
  email?: string;
}

/**
 * Person field specific props.
 */
export interface PersonFieldProps extends BaseFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Available person options */
  options?: PersonOption[];
  /** Whether multiple selections are allowed */
  multi?: boolean;
}
