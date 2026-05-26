/**
 * Project Service Errors Tests
 */

import {
  ProjectServiceError,
  isProjectError,
  projectErrorMessage,
  type ProjectError,
} from './errors';

describe('errors', () => {
  describe('projectErrorMessage', () => {
    it('formats unsupported_file error', () => {
      const error: ProjectError = {
        type: 'unsupported_file',
        path: '/path/to/file.exe',
        extension: 'exe',
      };
      expect(projectErrorMessage(error)).toBe('Unsupported file type: .exe');
    });

    it('formats file_not_found error', () => {
      const error: ProjectError = {
        type: 'file_not_found',
        path: '/path/to/missing.xlsx',
      };
      expect(projectErrorMessage(error)).toBe('File not found: /path/to/missing.xlsx');
    });

    it('formats permission_denied error', () => {
      const error: ProjectError = {
        type: 'permission_denied',
        path: '/protected/file.xlsx',
        operation: 'write',
      };
      expect(projectErrorMessage(error)).toBe(
        'Permission denied: cannot write /protected/file.xlsx',
      );
    });

    it('formats file_already_open error', () => {
      const error: ProjectError = {
        type: 'file_already_open',
        path: '/path/to/file.xlsx',
        fileId: 'abc-123',
      };
      expect(projectErrorMessage(error)).toBe('File is already open');
    });

    it('formats save_failed error', () => {
      const error: ProjectError = {
        type: 'save_failed',
        path: '/path/to/file.xlsx',
        reason: 'Disk full',
      };
      expect(projectErrorMessage(error)).toBe('Failed to save: Disk full');
    });

    it('formats scan_failed error', () => {
      const error: ProjectError = {
        type: 'scan_failed',
        path: '/path/to/folder',
        reason: 'Access denied',
      };
      expect(projectErrorMessage(error)).toBe('Failed to scan folder: Access denied');
    });

    it('formats unsaved_changes error', () => {
      const error: ProjectError = {
        type: 'unsaved_changes',
        fileIds: ['file1', 'file2', 'file3'],
      };
      expect(projectErrorMessage(error)).toBe('There are unsaved changes in 3 file(s)');
    });

    it('formats unsaved_changes error with single file', () => {
      const error: ProjectError = {
        type: 'unsaved_changes',
        fileIds: ['file1'],
      };
      expect(projectErrorMessage(error)).toBe('There are unsaved changes in 1 file(s)');
    });
  });

  describe('ProjectServiceError', () => {
    it('creates error with correct message', () => {
      const projectError: ProjectError = {
        type: 'file_not_found',
        path: '/missing.xlsx',
      };
      const error = new ProjectServiceError(projectError);

      expect(error.message).toBe('File not found: /missing.xlsx');
      expect(error.name).toBe('ProjectServiceError');
      expect(error.error).toBe(projectError);
    });

    it('is instance of Error', () => {
      const error = new ProjectServiceError({
        type: 'file_not_found',
        path: '/test.xlsx',
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ProjectServiceError);
    });

    it('preserves error details', () => {
      const projectError: ProjectError = {
        type: 'permission_denied',
        path: '/protected/file.xlsx',
        operation: 'delete',
      };
      const error = new ProjectServiceError(projectError);

      expect(error.error.type).toBe('permission_denied');
      expect(error.error).toHaveProperty('operation', 'delete');
    });
  });

  describe('isProjectError', () => {
    it('returns true for ProjectServiceError', () => {
      const error = new ProjectServiceError({
        type: 'file_not_found',
        path: '/test.xlsx',
      });

      expect(isProjectError(error)).toBe(true);
    });

    it('returns false for regular Error', () => {
      const error = new Error('Some error');

      expect(isProjectError(error)).toBe(false);
    });

    it('returns false for non-error values', () => {
      expect(isProjectError(null)).toBe(false);
      expect(isProjectError(undefined)).toBe(false);
      expect(isProjectError('string')).toBe(false);
      expect(isProjectError({})).toBe(false);
    });
  });

  describe('type exhaustiveness', () => {
    it('handles all error types in switch', () => {
      // This test ensures the switch in projectErrorMessage is exhaustive
      // If a new error type is added without handling, TypeScript will catch it
      const errorTypes: ProjectError['type'][] = [
        'unsupported_file',
        'file_not_found',
        'permission_denied',
        'file_already_open',
        'save_failed',
        'scan_failed',
        'unsaved_changes',
      ];

      errorTypes.forEach((type) => {
        // Create minimal error of each type
        let error: ProjectError;
        switch (type) {
          case 'unsupported_file':
            error = { type, path: '', extension: '' };
            break;
          case 'file_not_found':
            error = { type, path: '' };
            break;
          case 'permission_denied':
            error = { type, path: '', operation: '' };
            break;
          case 'file_already_open':
            error = { type, path: '', fileId: '' };
            break;
          case 'save_failed':
            error = { type, path: '', reason: '' };
            break;
          case 'scan_failed':
            error = { type, path: '', reason: '' };
            break;
          case 'unsaved_changes':
            error = { type, fileIds: [] };
            break;
        }

        // Should not throw
        expect(() => projectErrorMessage(error)).not.toThrow();
      });
    });
  });
});
