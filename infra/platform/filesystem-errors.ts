export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'FileSystemError';
  }
}

export class FileNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`File not found: ${path}`, path, 'ENOENT');
    this.name = 'FileNotFoundError';
  }
}

export class DirectoryNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`Directory not found: ${path}`, path, 'ENOENT');
    this.name = 'DirectoryNotFoundError';
  }
}

export class FileExistsError extends FileSystemError {
  constructor(path: string) {
    super(`File already exists: ${path}`, path, 'EEXIST');
    this.name = 'FileExistsError';
  }
}

export class DirectoryExistsError extends FileSystemError {
  constructor(path: string) {
    super(`Directory already exists: ${path}`, path, 'EEXIST');
    this.name = 'DirectoryExistsError';
  }
}

export class DirectoryNotEmptyError extends FileSystemError {
  constructor(path: string) {
    super(`Directory not empty: ${path}`, path, 'ENOTEMPTY');
    this.name = 'DirectoryNotEmptyError';
  }
}

export class IsDirectoryError extends FileSystemError {
  constructor(path: string) {
    super(`Is a directory: ${path}`, path, 'EISDIR');
    this.name = 'IsDirectoryError';
  }
}

export class NotDirectoryError extends FileSystemError {
  constructor(path: string) {
    super(`Not a directory: ${path}`, path, 'ENOTDIR');
    this.name = 'NotDirectoryError';
  }
}
