/**
 * Theme Constants for Canvas Renderer
 *
 * Default theme used for rendering when no theme is explicitly provided.
 */

import type { ThemeDefinition } from '@mog-sdk/contracts/theme';

export const OFFICE_THEME: ThemeDefinition = {
  id: 'office',
  name: 'Office',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#44546a',
    light2: '#e7e6e6',
    accent1: '#4472c4',
    accent2: '#ed7d31',
    accent3: '#a5a5a5',
    accent4: '#ffc000',
    accent5: '#5b9bd5',
    accent6: '#70ad47',
    hyperlink: '#0563c1',
    followedHyperlink: '#954f72',
  },
  fonts: {
    majorFont: 'Calibri Light',
    minorFont: 'Calibri',
  },
};
