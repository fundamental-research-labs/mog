import type { AppId, AppManifest } from '../../types';

const manifest = {
  id: 'task-tracker' as AppId,
  name: 'Task Tracker',
  version: '0.1.0',
  description: 'A simple task tracking app for Mog shell conformance tests',
  author: 'Mog',
  icon: 'task-tracker',
  entry: { module: '@mog/test-task-tracker', export: 'default' },
  kind: 'dataset-app' as const,
  compatibility: [{ profile: 'mog.app-platform/v1', versionRange: '>=0.1.0' }],
  capabilities: ['services:basic'],
  routes: [{ path: '/tasks' }, { path: '/tasks/:id' }],
  data: { resourceKinds: ['mog.resource.table'] },
  contributions: [
    {
      contributionPointId: 'mog.navigation',
      kind: 'navigation',
      id: 'task-tracker-nav',
      label: 'Tasks',
      icon: 'check-square',
    },
    {
      contributionPointId: 'mog.commands',
      kind: 'command',
      id: 'task-tracker-new-task',
      label: 'New Task',
    },
  ],
  lifecycle: { suspendable: true },
  runtimeHost: 'same-realm-first-party' as const,
};

export const TASK_TRACKER_MANIFEST = manifest as unknown as AppManifest;
