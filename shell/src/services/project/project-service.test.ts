/**
 * Project Service Tests
 *
 * Tests for the project service using Jest and the mock IPC implementation.
 * Tests cover project operations, file operations, navigation, and save operations.
 */
import { create, type StoreApi } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { IPlatform } from '@mog-sdk/contracts/platform';
import { FileTypeRegistry } from '../../lib/file-type-registry';
import { createProjectSlice, type ProjectSlice } from '../../ui-store/slices/project';
import type { DocumentManager } from '../document';
import { ProjectServiceError } from './errors';
import { createMockFileSystem, createMockIpc, type MockFileSystem } from './mock-ipc';
import { createProjectService, type ProjectServiceDeps } from './project-service';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal mock document manager for testing.
 * The mock does nothing since we're testing ProjectService, not DocumentManager.
 */
function createMockDocumentManager(): DocumentManager {
  return {
    loadDocument: jest.fn().mockResolvedValue({ dispose: jest.fn() }),
    createDocument: jest.fn().mockResolvedValue({ dispose: jest.fn() }),
    getDocument: jest.fn().mockReturnValue(null),
    disposeDocument: jest.fn(),
    disposeAll: jest.fn(),
    getLoadingState: jest.fn().mockReturnValue('idle'),
    getError: jest.fn().mockReturnValue(null),
    getOpenFileIds: jest.fn().mockReturnValue([]),
    subscribe: jest.fn().mockReturnValue(() => {}),
    getState: jest.fn().mockReturnValue({
      documents: new Map(),
      loadingStates: new Map(),
      errors: new Map(),
    }),
  };
}

/**
 * Create a minimal mock platform for testing.
 */
function createMockPlatform(): IPlatform {
  return {
    name: 'desktop',
    filesystem: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      deleteFile: jest.fn(),
      exists: jest.fn(),
      mkdir: jest.fn(),
      readDir: jest.fn(),
      stat: jest.fn(),
      rename: jest.fn(),
      copy: jest.fn(),
    },
    dialogs: {
      // PlatformFileHandle return shape (shell-service facade): default to
      // `null` to model a cancelled dialog. Tests that exercise dialog
      // outcomes can override per-call via mockResolvedValueOnce.
      showOpenDialog: jest.fn().mockResolvedValue(null),
      showSaveDialog: jest.fn().mockResolvedValue(null),
      showOpenFolderDialog: jest.fn().mockResolvedValue(null),
      confirm: jest.fn().mockResolvedValue(false),
      alert: jest.fn().mockResolvedValue(undefined),
    },
    notifications: {
      show: jest.fn(),
      requestPermission: jest.fn(),
    },
    clipboard: {
      readText: jest.fn(),
      writeText: jest.fn(),
      readImage: jest.fn(),
      writeImage: jest.fn(),
    },
    shell: {
      openExternal: jest.fn(),
      revealInFileManager: jest.fn(),
      setWindowTitle: jest.fn(),
    },
  } as unknown as IPlatform;
}

/**
 * Create a test store with the project slice.
 */
function createTestStore(): StoreApi<ProjectSlice> {
  return create<ProjectSlice>()(subscribeWithSelector(createProjectSlice));
}

/**
 * Create test dependencies with optional pre-populated filesystem.
 */
function createTestDeps(fs?: MockFileSystem): {
  deps: ProjectServiceDeps;
  store: StoreApi<ProjectSlice>;
  platform: IPlatform;
  documentManager: DocumentManager;
  fs: MockFileSystem;
} {
  const mockFs = fs ?? createMockFileSystem();
  const store = createTestStore();
  const platform = createMockPlatform();
  const documentManager = createMockDocumentManager();

  const deps: ProjectServiceDeps = {
    store: store as unknown as ProjectServiceDeps['store'],
    platform,
    ipc: createMockIpc(mockFs),
    fileTypeRegistry: new FileTypeRegistry(),
    documentManager,
  };

  return { deps, store, platform, documentManager, fs: mockFs };
}

// =============================================================================
// Tests
// =============================================================================

describe('ProjectService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ===========================================================================
  // Project Operations
  // ===========================================================================

  describe('openProject', () => {
    it('opens a project folder and scans files', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/file1.xlsx', new Uint8Array([1, 2, 3])],
          ['/project/file2.csv', new Uint8Array([4, 5, 6])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');

      const state = store.getState();
      expect(state.projectPath).toBe('/project');
      expect(state.projectName).toBe('project');
      expect(state.singleFileMode).toBe(false);
    });

    it('sets window title to project name', async () => {
      const fs: MockFileSystem = {
        files: new Map(),
        directories: new Set(['/my-project']),
      };
      const { deps, platform } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/my-project');

      expect(platform.shell.setWindowTitle).toHaveBeenCalledWith('my-project - Spreadsheet OS');
    });

    it('sets file tree from scanned files', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/data.xlsx', new Uint8Array([1])],
          ['/project/reports/summary.csv', new Uint8Array([2])],
        ]),
        directories: new Set(['/project', '/project/reports']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');

      const state = store.getState();
      expect(state.fileTree.length).toBeGreaterThan(0);
    });

    it('auto-opens first spreadsheet file', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/first.xlsx', new Uint8Array([1, 2, 3])],
          ['/project/second.csv', new Uint8Array([4, 5, 6])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');

      const state = store.getState();
      expect(state.openFileIds.length).toBe(1);
      expect(state.activeFileId).not.toBeNull();
      const activeFile = state.files[state.activeFileId!];
      expect(activeFile.displayName).toBe('first.xlsx');
    });

    it('closes existing files when opening new project', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/old-project/old.xlsx', new Uint8Array([1])],
          ['/new-project/new.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/old-project', '/new-project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      // Open first project
      await service.openProject('/old-project');
      expect(store.getState().openFileIds.length).toBe(1);

      // Open new project
      await service.openProject('/new-project');

      const state = store.getState();
      expect(state.projectPath).toBe('/new-project');
      // Old file should be closed, new file auto-opened
      expect(state.openFileIds.length).toBe(1);
      const activeFile = state.files[state.activeFileId!];
      expect(activeFile.displayName).toBe('new.xlsx');
    });

    it('adds project to recent projects', async () => {
      const fs: MockFileSystem = {
        files: new Map(),
        directories: new Set(['/my-project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/my-project');

      const state = store.getState();
      expect(state.recentProjects.length).toBe(1);
      expect(state.recentProjects[0].path).toBe('/my-project');
      expect(state.recentProjects[0].name).toBe('my-project');
    });
  });

  describe('openSingleFile', () => {
    it('opens a single file in single file mode', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/documents/budget.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/documents']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openSingleFile('/documents/budget.xlsx');

      const state = store.getState();
      expect(state.singleFileMode).toBe(true);
      expect(state.projectPath).toBe('/documents');
      expect(state.activeFileId).toBe(fileId);
      expect(state.files[fileId].displayName).toBe('budget.xlsx');
    });

    it('sets window title to file name', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/documents/budget.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/documents']),
      };
      const { deps, platform } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openSingleFile('/documents/budget.xlsx');

      expect(platform.shell.setWindowTitle).toHaveBeenCalledWith('budget.xlsx - Spreadsheet OS');
    });
  });

  describe('closeProject', () => {
    it('closes project and resets state', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store, platform } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      const closed = await service.closeProject();

      expect(closed).toBe(true);
      const state = store.getState();
      expect(state.projectPath).toBeNull();
      expect(state.projectName).toBeNull();
      expect(platform.shell.setWindowTitle).toHaveBeenLastCalledWith('Spreadsheet OS');
    });

    it('blocks closing when unsaved changes exist', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      const activeFileId = store.getState().activeFileId!;
      store.getState().updateFile(activeFileId, { isModified: true });

      const closed = await service.closeProject();
      expect(closed).toBe(false);
      expect(store.getState().projectPath).toBe('/project');
    });

    it('force closes even with unsaved changes', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      const activeFileId = store.getState().activeFileId!;
      store.getState().updateFile(activeFileId, { isModified: true });

      const closed = await service.closeProject(true);
      expect(closed).toBe(true);
      expect(store.getState().projectPath).toBeNull();
    });
  });

  describe('refreshFileTree', () => {
    it('refreshes file tree from disk', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/initial.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      expect(store.getState().fileTree.length).toBe(1);

      // Add new file
      fs.files.set('/project/added.csv', new Uint8Array([2]));

      await service.refreshFileTree();
      expect(store.getState().fileTree.length).toBe(2);
    });

    it('preserves expanded folder state', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/folder/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project', '/project/folder']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      service.toggleFolderExpanded('/project/folder');

      // Verify folder is expanded
      let folder = store.getState().fileTree.find((e) => e.path === '/project/folder');
      expect(folder?.isExpanded).toBe(true);

      await service.refreshFileTree();

      // Verify folder stays expanded after refresh
      folder = store.getState().fileTree.find((e) => e.path === '/project/folder');
      expect(folder?.isExpanded).toBe(true);
    });

    it('does nothing in single file mode', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/documents/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/documents']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openSingleFile('/documents/file.xlsx');
      const treeBefore = store.getState().fileTree;

      await service.refreshFileTree();

      expect(store.getState().fileTree).toBe(treeBefore);
    });
  });

  describe('toggleFolderExpanded', () => {
    it('toggles folder expanded state', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/folder/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project', '/project/folder']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');

      // Initially collapsed
      let folder = store.getState().fileTree.find((e) => e.path === '/project/folder');
      expect(folder?.isExpanded).toBeFalsy();

      // Toggle to expanded
      service.toggleFolderExpanded('/project/folder');
      folder = store.getState().fileTree.find((e) => e.path === '/project/folder');
      expect(folder?.isExpanded).toBe(true);

      // Toggle back to collapsed
      service.toggleFolderExpanded('/project/folder');
      folder = store.getState().fileTree.find((e) => e.path === '/project/folder');
      expect(folder?.isExpanded).toBe(false);
    });
  });

  // ===========================================================================
  // File Operations
  // ===========================================================================

  describe('openFile', () => {
    it('opens a file and adds it to open files', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');

      const state = store.getState();
      expect(state.files[fileId]).toBeDefined();
      expect(state.files[fileId].displayName).toBe('test.xlsx');
      expect(state.activeFileId).toBe(fileId);
      expect(state.openFileIds).toContain(fileId);
    });

    it('loads spreadsheet files via DocumentManager with bytes read through project IPC', async () => {
      const testData = new Uint8Array([10, 20, 30, 40]);
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', testData]]),
        directories: new Set(['/project']),
      };
      const { deps, documentManager } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');

      expect(documentManager.loadDocument).toHaveBeenCalledWith(
        fileId,
        {
          type: 'bytes',
          data: testData,
        },
        { kind: 'xlsx' },
      );
    });

    it('throws for unsupported file types', async () => {
      const { deps } = createTestDeps();
      const service = createProjectService(deps);

      await expect(service.openFile('/project/test.exe')).rejects.toThrow(ProjectServiceError);
    });

    it('reuses existing file if already open', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId1 = await service.openFile('/project/test.xlsx');
      const fileId2 = await service.openFile('/project/test.xlsx');

      expect(fileId1).toBe(fileId2);
      expect(store.getState().openFileIds.length).toBe(1);
    });

    it('switches to existing file when opening again', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileIdA = await service.openFile('/project/a.xlsx');
      await service.openFile('/project/b.xlsx');
      expect(store.getState().activeFileId).not.toBe(fileIdA);

      // Open a.xlsx again
      await service.openFile('/project/a.xlsx');
      expect(store.getState().activeFileId).toBe(fileIdA);
    });

    it('sets document type from file extension', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/data.csv', new Uint8Array([1])],
          ['/project/script.ts', new Uint8Array([2])],
          ['/project/readme.md', new Uint8Array([3])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const csvId = await service.openFile('/project/data.csv');
      const tsId = await service.openFile('/project/script.ts');
      const mdId = await service.openFile('/project/readme.md');

      expect(store.getState().files[csvId].documentType).toBe('spreadsheet');
      expect(store.getState().files[tsId].documentType).toBe('code');
      expect(store.getState().files[mdId].documentType).toBe('markdown');
    });
  });

  describe('newFile', () => {
    it('creates a new untitled file via DocumentManager', async () => {
      const { deps, store, documentManager } = createTestDeps();
      const service = createProjectService(deps);

      const fileId = await service.newFile();

      const state = store.getState();
      expect(state.files[fileId].displayName).toBe('Untitled');
      expect(state.files[fileId].filePath).toBeNull();
      expect(state.files[fileId].documentType).toBe('spreadsheet');
      expect(documentManager.createDocument).toHaveBeenCalledWith(fileId);
    });

    it('increments untitled count for subsequent files', async () => {
      const { deps, store } = createTestDeps();
      const service = createProjectService(deps);

      const fileId1 = await service.newFile();
      const fileId2 = await service.newFile();
      const fileId3 = await service.newFile();

      const state = store.getState();
      expect(state.files[fileId1].displayName).toBe('Untitled');
      expect(state.files[fileId2].displayName).toBe('Untitled 2');
      expect(state.files[fileId3].displayName).toBe('Untitled 3');
    });

    it('sets new file as active', async () => {
      const { deps, store } = createTestDeps();
      const service = createProjectService(deps);

      const fileId = await service.newFile();

      expect(store.getState().activeFileId).toBe(fileId);
      expect(store.getState().openFileIds).toContain(fileId);
    });
  });

  describe('closeFile', () => {
    it('closes a file, disposes document, and removes from state', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store, documentManager } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      const closed = await service.closeFile(fileId);

      expect(closed).toBe(true);
      const state = store.getState();
      expect(state.files[fileId]).toBeUndefined();
      expect(state.openFileIds).not.toContain(fileId);
      expect(documentManager.disposeDocument).toHaveBeenCalledWith(fileId);
    });

    it('blocks closing modified file without force', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      store.getState().updateFile(fileId, { isModified: true });

      const closed = await service.closeFile(fileId);
      expect(closed).toBe(false);
      expect(store.getState().files[fileId]).toBeDefined();
    });

    it('force closes modified file', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      store.getState().updateFile(fileId, { isModified: true });

      const closed = await service.closeFile(fileId, true);
      expect(closed).toBe(true);
      expect(store.getState().files[fileId]).toBeUndefined();
    });

    it('switches to adjacent file when closing active file', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
          ['/project/c.xlsx', new Uint8Array([3])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openFile('/project/a.xlsx');
      const fileIdB = await service.openFile('/project/b.xlsx');
      await service.openFile('/project/c.xlsx');

      // b is in the middle, close it
      await service.closeFile(fileIdB);

      // Should switch to c (next) or a (previous)
      expect(store.getState().activeFileId).not.toBe(fileIdB);
      expect(store.getState().openFileIds.length).toBe(2);
    });

    it('disposes document when closing new file', async () => {
      const { deps, documentManager } = createTestDeps();
      const service = createProjectService(deps);

      const fileId = await service.newFile();
      await service.closeFile(fileId, true);

      expect(documentManager.disposeDocument).toHaveBeenCalledWith(fileId);
    });
  });

  // ===========================================================================
  // Navigation
  // ===========================================================================

  describe('switchToFile', () => {
    it('switches to specified file', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId1 = await service.openFile('/project/a.xlsx');
      await service.openFile('/project/b.xlsx');
      expect(store.getState().activeFileId).not.toBe(fileId1);

      service.switchToFile(fileId1);
      expect(store.getState().activeFileId).toBe(fileId1);
    });

    it('updates window title when switching', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store, platform } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId1 = await service.openFile('/project/a.xlsx');
      await service.openFile('/project/b.xlsx');

      service.switchToFile(fileId1);

      expect(platform.shell.setWindowTitle).toHaveBeenLastCalledWith('a.xlsx - Spreadsheet OS');
    });

    it('does nothing for non-existent file', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/a.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/a.xlsx');
      service.switchToFile('non-existent-id');

      expect(store.getState().activeFileId).toBe(fileId);
    });
  });

  describe('switchToNextTab', () => {
    it('switches to next tab', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
          ['/project/c.xlsx', new Uint8Array([3])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileIdA = await service.openFile('/project/a.xlsx');
      const fileIdB = await service.openFile('/project/b.xlsx');
      await service.openFile('/project/c.xlsx');

      // Switch to a first
      service.switchToFile(fileIdA);
      expect(store.getState().activeFileId).toBe(fileIdA);

      service.switchToNextTab();
      expect(store.getState().activeFileId).toBe(fileIdB);
    });

    it('wraps around to first tab', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileIdA = await service.openFile('/project/a.xlsx');
      const fileIdB = await service.openFile('/project/b.xlsx');

      // Currently on b (last opened)
      expect(store.getState().activeFileId).toBe(fileIdB);

      service.switchToNextTab();
      expect(store.getState().activeFileId).toBe(fileIdA);
    });

    it('does nothing with no open files', () => {
      const { deps, store } = createTestDeps();
      const service = createProjectService(deps);

      service.switchToNextTab();
      expect(store.getState().activeFileId).toBeNull();
    });
  });

  describe('switchToPrevTab', () => {
    it('switches to previous tab', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
          ['/project/c.xlsx', new Uint8Array([3])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileIdA = await service.openFile('/project/a.xlsx');
      const fileIdB = await service.openFile('/project/b.xlsx');
      const fileIdC = await service.openFile('/project/c.xlsx');

      // Currently on c
      expect(store.getState().activeFileId).toBe(fileIdC);

      service.switchToPrevTab();
      expect(store.getState().activeFileId).toBe(fileIdB);

      service.switchToPrevTab();
      expect(store.getState().activeFileId).toBe(fileIdA);
    });

    it('wraps around to last tab', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/a.xlsx', new Uint8Array([1])],
          ['/project/b.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileIdA = await service.openFile('/project/a.xlsx');
      const fileIdB = await service.openFile('/project/b.xlsx');

      service.switchToFile(fileIdA);
      expect(store.getState().activeFileId).toBe(fileIdA);

      service.switchToPrevTab();
      expect(store.getState().activeFileId).toBe(fileIdB);
    });
  });

  // ===========================================================================
  // Save Operations
  // ===========================================================================

  describe('saveFile', () => {
    it('saves file to disk', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      store.getState().updateFile(fileId, { isModified: true });

      const newContent = new Uint8Array([10, 20, 30]);
      await service.saveFile(fileId, newContent);

      // Check file was written
      expect(fs.files.get('/project/test.xlsx')).toEqual(newContent);

      // Check state updated
      const state = store.getState();
      expect(state.files[fileId].isModified).toBe(false);
      expect(state.files[fileId].lastSaved).not.toBeNull();
    });

    it('saves to specified path (Save As)', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      const newContent = new Uint8Array([10, 20, 30]);

      await service.saveFile(fileId, newContent, '/project/saved-as.xlsx');

      // Check new file exists
      expect(fs.files.get('/project/saved-as.xlsx')).toEqual(newContent);

      // Check state updated with new path
      const state = store.getState();
      expect(state.files[fileId].filePath).toBe('/project/saved-as.xlsx');
      expect(state.files[fileId].displayName).toBe('saved-as.xlsx');
    });

    it('throws for new file without path', async () => {
      const { deps } = createTestDeps();
      const service = createProjectService(deps);

      const fileId = await service.newFile();
      const content = new Uint8Array([1, 2, 3]);

      await expect(service.saveFile(fileId, content)).rejects.toThrow(ProjectServiceError);
    });

    it('throws for non-existent file', async () => {
      const { deps } = createTestDeps();
      const service = createProjectService(deps);

      const content = new Uint8Array([1, 2, 3]);
      await expect(service.saveFile('non-existent', content)).rejects.toThrow(ProjectServiceError);
    });

    it('updates window title after save', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, platform } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      await service.saveFile(fileId, new Uint8Array([2]), '/project/renamed.xlsx');

      expect(platform.shell.setWindowTitle).toHaveBeenLastCalledWith(
        'renamed.xlsx - Spreadsheet OS',
      );
    });
  });

  // ===========================================================================
  // File Tree Operations
  // ===========================================================================

  describe('renameFile', () => {
    it('renames file on disk and in state', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/old-name.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/old-name.xlsx');
      const newPath = await service.renameFile('/project/old-name.xlsx', 'new-name.xlsx');

      expect(newPath).toBe('/project/new-name.xlsx');
      expect(fs.files.has('/project/new-name.xlsx')).toBe(true);
      expect(fs.files.has('/project/old-name.xlsx')).toBe(false);

      const state = store.getState();
      expect(state.files[fileId].filePath).toBe('/project/new-name.xlsx');
      expect(state.files[fileId].displayName).toBe('new-name.xlsx');
    });

    it('updates window title when renaming active file', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/old-name.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, platform } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openFile('/project/old-name.xlsx');
      await service.renameFile('/project/old-name.xlsx', 'new-name.xlsx');

      expect(platform.shell.setWindowTitle).toHaveBeenLastCalledWith(
        'new-name.xlsx - Spreadsheet OS',
      );
    });
  });

  describe('deleteFile', () => {
    it('deletes file from disk', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/to-delete.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      await service.deleteFile('/project/to-delete.xlsx');

      expect(fs.files.has('/project/to-delete.xlsx')).toBe(false);
    });

    it('closes open file when deleted', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      expect(store.getState().files[fileId]).toBeDefined();

      await service.deleteFile('/project/test.xlsx');

      expect(store.getState().files[fileId]).toBeUndefined();
    });

    it('deletes folder and all contents', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/folder/file1.xlsx', new Uint8Array([1])],
          ['/project/folder/file2.csv', new Uint8Array([2])],
        ]),
        directories: new Set(['/project', '/project/folder']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      await service.deleteFile('/project/folder');

      expect(fs.directories.has('/project/folder')).toBe(false);
      expect(fs.files.has('/project/folder/file1.xlsx')).toBe(false);
      expect(fs.files.has('/project/folder/file2.csv')).toBe(false);
    });
  });

  describe('createSpreadsheetInFolder', () => {
    it('creates new spreadsheet with unique name', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/Untitled.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      const newPath = await service.createSpreadsheetInFolder('/project');

      // Should create Untitled 1.xlsx since Untitled.xlsx exists
      expect(newPath).toBe('/project/Untitled 1.xlsx');
      expect(fs.files.has(newPath)).toBe(true);
    });
  });

  describe('createFolder', () => {
    it('creates new folder with unique name', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/existing.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project', '/project/New Folder']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      const newPath = await service.createFolder('/project');

      // Should create "New Folder 1" since "New Folder" exists
      expect(newPath).toBe('/project/New Folder 1');
      expect(fs.directories.has(newPath)).toBe(true);
    });
  });

  describe('importFiles', () => {
    it('imports files into target directory', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/external/source.xlsx', new Uint8Array([1, 2, 3])]]),
        directories: new Set(['/project', '/external']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');
      const imported = await service.importFiles(['/external/source.xlsx'], '/project');

      expect(imported).toEqual(['/project/source.xlsx']);
      expect(fs.files.has('/project/source.xlsx')).toBe(true);
      // Original file should still exist
      expect(fs.files.has('/external/source.xlsx')).toBe(true);
    });
  });

  // ===========================================================================
  // Recent Projects
  // ===========================================================================

  describe('loadRecentProjects', () => {
    it('loads recent projects into state', async () => {
      const { deps, store } = createTestDeps();
      const service = createProjectService(deps);

      // Add some recent projects via IPC
      await deps.ipc.add_recent_project({
        project: { path: '/project1', name: 'Project 1', lastOpened: new Date().toISOString() },
      });
      await deps.ipc.add_recent_project({
        project: { path: '/project2', name: 'Project 2', lastOpened: new Date().toISOString() },
      });

      await service.loadRecentProjects();

      const state = store.getState();
      expect(state.recentProjects.length).toBe(2);
    });
  });

  describe('addRecentProject', () => {
    it('adds project to recent list', async () => {
      const { deps, store } = createTestDeps();
      const service = createProjectService(deps);

      await service.addRecentProject('/new-project', 'New Project');

      const state = store.getState();
      expect(state.recentProjects.length).toBe(1);
      expect(state.recentProjects[0].path).toBe('/new-project');
      expect(state.recentProjects[0].name).toBe('New Project');
    });
  });

  // ===========================================================================
  // Queries
  // ===========================================================================

  describe('hasUnsavedChanges', () => {
    it('returns false when no files modified', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openFile('/project/test.xlsx');
      expect(service.hasUnsavedChanges()).toBe(false);
    });

    it('returns true when file is modified', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps, store } = createTestDeps(fs);
      const service = createProjectService(deps);

      const fileId = await service.openFile('/project/test.xlsx');
      store.getState().updateFile(fileId, { isModified: true });

      expect(service.hasUnsavedChanges()).toBe(true);
    });

    it('returns true when new file is modified', async () => {
      const { deps, store } = createTestDeps();
      const service = createProjectService(deps);

      const fileId = await service.newFile();
      // New files start as not modified
      expect(service.hasUnsavedChanges()).toBe(false);

      // Mark as modified
      store.getState().updateFile(fileId, { isModified: true });
      expect(service.hasUnsavedChanges()).toBe(true);
    });
  });

  describe('getActiveFile', () => {
    it('returns undefined when no active file', () => {
      const { deps } = createTestDeps();
      const service = createProjectService(deps);

      expect(service.getActiveFile()).toBeUndefined();
    });

    it('returns active file metadata', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/project/test.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/project']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openFile('/project/test.xlsx');

      const activeFile = service.getActiveFile();
      expect(activeFile).toBeDefined();
      expect(activeFile?.displayName).toBe('test.xlsx');
    });
  });

  // ===========================================================================
  // Security / Path Validation
  // ===========================================================================

  describe('path validation', () => {
    it('blocks file operations outside project directory', async () => {
      const fs: MockFileSystem = {
        files: new Map([
          ['/project/file.xlsx', new Uint8Array([1])],
          ['/outside/secret.xlsx', new Uint8Array([2])],
        ]),
        directories: new Set(['/project', '/outside']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      await service.openProject('/project');

      // Try to open file outside project
      await expect(service.openFile('/outside/secret.xlsx')).rejects.toThrow(ProjectServiceError);
    });

    it('allows operations in single file mode', async () => {
      const fs: MockFileSystem = {
        files: new Map([['/documents/file.xlsx', new Uint8Array([1])]]),
        directories: new Set(['/documents']),
      };
      const { deps } = createTestDeps(fs);
      const service = createProjectService(deps);

      // Single file mode allows the file
      await expect(service.openSingleFile('/documents/file.xlsx')).resolves.toBeDefined();
    });
  });
});
