/**
 * Project Service Errors
 *
 * Typed errors for better error handling across the app.
 * Use discriminated union for exhaustive switch statements.
 */

export type ProjectError =
  | { type: 'unsupported_file'; path: string; extension: string }
  | { type: 'file_not_found'; path: string }
  | { type: 'permission_denied'; path: string; operation: string }
  | { type: 'file_already_open'; path: string; fileId: string }
  | { type: 'save_failed'; path: string; reason: string }
  | { type: 'scan_failed'; path: string; reason: string }
  | { type: 'unsaved_changes'; fileIds: string[] };

export function projectErrorMessage(error: ProjectError): string {
  switch (error.type) {
    case 'unsupported_file':
      return `Unsupported file type: .${error.extension}`;
    case 'file_not_found':
      return `File not found: ${error.path}`;
    case 'permission_denied':
      return `Permission denied: cannot ${error.operation} ${error.path}`;
    case 'file_already_open':
      return `File is already open`;
    case 'save_failed':
      return `Failed to save: ${error.reason}`;
    case 'scan_failed':
      return `Failed to scan folder: ${error.reason}`;
    case 'unsaved_changes':
      return `There are unsaved changes in ${error.fileIds.length} file(s)`;
  }
}

export class ProjectServiceError extends Error {
  constructor(public readonly error: ProjectError) {
    super(projectErrorMessage(error));
    this.name = 'ProjectServiceError';
  }
}

/** Type guard for ProjectServiceError */
export function isProjectError(err: unknown): err is ProjectServiceError {
  return err instanceof ProjectServiceError;
}
