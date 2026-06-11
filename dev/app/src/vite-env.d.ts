/// <reference types="vite/client" />

import type { ShellBootstrapResult } from '@mog/shell';

declare global {
  interface Window {
    __SHELL__?: ShellBootstrapResult;
  }
}

export {};
