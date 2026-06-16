import { MogSdkError } from '../../errors';

const SAVE_OPERATION = 'workbook.save';

type RuntimeProcess = {
  cwd?: () => string;
};

export interface WorkbookSavePathTarget {
  readonly requestedPath: string;
  readonly cwd?: string;
}

type ErrorLikeDetails = {
  readonly name?: string;
  readonly message?: string;
  readonly code?: string;
  readonly filesystemCode?: string;
  readonly requestedPath?: string;
  readonly absolutePath?: string;
  readonly cwd?: string;
  readonly parentDirectory?: string;
};

function currentWorkingDirectory(): string | undefined {
  const processLike = (globalThis as { process?: RuntimeProcess }).process;
  if (typeof processLike?.cwd !== 'function') return undefined;
  try {
    return processLike.cwd();
  } catch {
    return undefined;
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return quote(value);
  return `${typeof value} ${quote(String(value))}`;
}

function stringField(value: unknown, field: keyof ErrorLikeDetails): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : undefined;
}

function errorDetails(error: unknown): ErrorLikeDetails {
  return {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    code: stringField(error, 'code'),
    filesystemCode: stringField(error, 'filesystemCode') ?? stringField(error, 'code'),
    requestedPath: stringField(error, 'requestedPath'),
    absolutePath: stringField(error, 'absolutePath'),
    cwd: stringField(error, 'cwd'),
    parentDirectory: stringField(error, 'parentDirectory'),
  };
}

function pathExamples(): readonly string[] {
  return [
    'await wb.save("output.xlsx")',
    'await wb.save("./outputs/model.xlsx")',
    'const bytes = await wb.save()',
  ];
}

function reasonForFilesystemCode(code: string | undefined): string {
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'The runtime does not have permission to write there. Choose a writable directory or adjust filesystem permissions.';
    case 'EISDIR':
      return 'The path points to a directory. Include a filename, for example "output.xlsx".';
    case 'ENOTDIR':
      return 'One of the parent path segments is a file, not a directory. Choose a different output path.';
    case 'ENOENT':
      return 'The path is not available in this runtime filesystem. Use a path under the current working directory or another existing writable root.';
    case 'ENAMETOOLONG':
      return 'The path is too long for the filesystem. Use a shorter directory or filename.';
    case 'EEXIST':
      return 'A parent path already exists but is not a directory. Choose a different output directory.';
    default:
      return 'Use a local filesystem path in a writable directory, or call wb.save() without a path to get XLSX bytes.';
  }
}

export function normalizeWorkbookSavePath(path: unknown): WorkbookSavePathTarget | undefined {
  if (path === undefined) return undefined;

  const cwd = currentWorkingDirectory();
  const commonDetails = {
    issue: 'save-path-invalid',
    operation: SAVE_OPERATION,
    cwd,
    examples: pathExamples(),
  };

  if (typeof path !== 'string') {
    throw new MogSdkError(
      'INVALID_ARGUMENT',
      `wb.save(path) expected path to be a string, but received ${describeValue(path)}. Use wb.save() with no arguments to get XLSX bytes, or pass a file path like "output.xlsx".`,
      {
        operation: SAVE_OPERATION,
        details: {
          ...commonDetails,
          receivedType: path === null ? 'null' : typeof path,
          received: String(path),
        },
        diagnostics: { domain: 'API', issueCode: 'SAVE_PATH_INVALID_TYPE', severity: 'error' },
      },
    );
  }

  if (path.trim().length === 0) {
    throw new MogSdkError(
      'INVALID_ARGUMENT',
      'wb.save(path) received an empty path. Use wb.save() with no arguments to get XLSX bytes, or pass a non-empty file path like "output.xlsx".',
      {
        operation: SAVE_OPERATION,
        details: {
          ...commonDetails,
          requestedPath: path,
        },
        diagnostics: { domain: 'API', issueCode: 'SAVE_PATH_EMPTY', severity: 'error' },
      },
    );
  }

  if (path.includes('\0')) {
    throw new MogSdkError(
      'INVALID_ARGUMENT',
      `wb.save(${quote(path)}) received a path containing a NUL character, which cannot be a filesystem path. Pass a normal local path like "output.xlsx".`,
      {
        operation: SAVE_OPERATION,
        details: {
          ...commonDetails,
          requestedPath: path,
        },
        diagnostics: { domain: 'API', issueCode: 'SAVE_PATH_NUL_BYTE', severity: 'error' },
      },
    );
  }

  return { requestedPath: path, cwd };
}

export function createSaveWriterUnavailableError(target: WorkbookSavePathTarget): MogSdkError {
  return new MogSdkError(
    'INVALID_ARGUMENT',
    `wb.save(${quote(target.requestedPath)}) cannot write a file in this runtime because no file writer is configured. Use the Node SDK file writer, provide createWorkbook({ writeFile }), or call wb.save() with no arguments to get XLSX bytes.`,
    {
      operation: SAVE_OPERATION,
      details: {
        issue: 'save-path-writer-unavailable',
        operation: SAVE_OPERATION,
        requestedPath: target.requestedPath,
        cwd: target.cwd,
        examples: pathExamples(),
      },
      diagnostics: { domain: 'API', issueCode: 'SAVE_FILE_WRITER_UNAVAILABLE', severity: 'error' },
    },
  );
}

export function createSaveWriteFailedError(
  target: WorkbookSavePathTarget,
  error: unknown,
): MogSdkError {
  const details = errorDetails(error);
  const filesystemCode = details.filesystemCode;
  const cwd = details.cwd ?? target.cwd;
  const requestedPath = details.requestedPath ?? target.requestedPath;
  const absolutePath = details.absolutePath;
  const originalMessage = details.message ?? String(error);
  const destination = absolutePath
    ? `${quote(requestedPath)} (resolved to ${quote(absolutePath)})`
    : quote(requestedPath);
  const codeLabel = filesystemCode ? ` ${filesystemCode}` : '';

  return new MogSdkError(
    'PROVIDER_ERROR',
    `wb.save(${quote(target.requestedPath)}) could not write the XLSX file to ${destination}.${cwd ? ` Current working directory: ${quote(cwd)}.` : ''} ${reasonForFilesystemCode(filesystemCode)} Original filesystem error${codeLabel}: ${originalMessage}`,
    {
      operation: SAVE_OPERATION,
      details: {
        issue: 'save-path-write-failed',
        operation: SAVE_OPERATION,
        requestedPath,
        absolutePath,
        cwd,
        parentDirectory: details.parentDirectory,
        filesystemCode,
        causeName: details.name,
        causeMessage: originalMessage,
        examples: pathExamples(),
      },
      diagnostics: {
        domain: 'FS',
        issueCode: filesystemCode ?? 'SAVE_FILE_WRITE_FAILED',
        severity: 'error',
      },
      cause: error,
    },
  );
}

export function createSaveCallbackFailedError(error: unknown): MogSdkError {
  const details = errorDetails(error);
  const originalMessage = details.message ?? String(error);
  return new MogSdkError(
    'PROVIDER_ERROR',
    `wb.save() exported XLSX bytes, but the host save callback failed. The workbook was not marked clean. Original host error: ${originalMessage}`,
    {
      operation: SAVE_OPERATION,
      details: {
        issue: 'save-callback-failed',
        operation: SAVE_OPERATION,
        causeName: details.name,
        causeMessage: originalMessage,
      },
      diagnostics: { domain: 'PROVIDER', issueCode: 'SAVE_CALLBACK_FAILED', severity: 'error' },
      cause: error,
    },
  );
}
