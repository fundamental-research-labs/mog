/**
 * Form Layout Component
 *
 * Container for form fields supporting single or two-column layouts.
 */

import * as React from 'react';
import type { FormLayout as FormLayoutType } from '../config';

export interface FormLayoutProps {
  /** Layout mode */
  layout: FormLayoutType;
  /** Form field children */
  children: React.ReactNode;
}

/**
 * Form layout container.
 */
export function FormLayout({ layout, children }: FormLayoutProps): React.ReactElement {
  const layoutClasses =
    layout === 'two-column' ? 'grid grid-cols-2 gap-x-6 gap-y-4' : 'flex flex-col gap-4';

  return <div className={layoutClasses}>{children}</div>;
}
