/**
 * File Column Renderer
 *
 * Renders file attachment values with support for:
 * - File icon display
 * - Image thumbnails
 * - File upload
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type {
  CardFieldProps,
  ColumnEditorProps,
  ColumnRenderer,
  FileAttachment,
  FormFieldProps,
} from '../types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get file extension from filename.
 */
function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Get file icon based on type.
 */
function getFileIcon(file: FileAttachment): string {
  const ext = getExtension(file.name);
  const type = file.type || '';

  // Images
  if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return '🖼️';
  }

  // PDFs
  if (type === 'application/pdf' || ext === 'pdf') {
    return '📄';
  }

  // Documents
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return '📝';
  }

  // Spreadsheets
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return '📊';
  }

  // Presentations
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return '📽️';
  }

  // Archives
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return '📦';
  }

  // Code
  if (['js', 'ts', 'py', 'java', 'html', 'css', 'json'].includes(ext)) {
    return '💻';
  }

  // Audio
  if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
    return '🎵';
  }

  // Video
  if (type.startsWith('video/') || ['mp4', 'avi', 'mov', 'webm'].includes(ext)) {
    return '🎬';
  }

  return '📎';
}

/**
 * Check if file is an image that can be previewed.
 */
function isPreviewableImage(file: FileAttachment): boolean {
  const ext = getExtension(file.name);
  const type = file.type || '';
  return type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// =============================================================================
// Display Renderer
// =============================================================================

function renderFile(
  value: FileAttachment | FileAttachment[] | null,
  _column: ColumnSchema,
): React.ReactNode {
  if (!value) {
    return null;
  }

  const files = Array.isArray(value) ? value : [value];

  if (files.length === 0) {
    return null;
  }

  return (
    <span className="file-renderer flex gap-ss-2 flex-wrap">
      {files.map((file) => (
        <a
          key={file.id}
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className="file-link inline-flex items-center gap-ss-1 bg-ss-surface-secondary rounded-ss text-body-sm"
          style={{
            padding: '2px 8px',
            textDecoration: 'none',
            color: 'inherit',
          }}
          title={`${file.name} (${formatFileSize(file.size)})`}
        >
          {isPreviewableImage(file) && file.thumbnailUrl ? (
            <img
              src={file.thumbnailUrl}
              alt={file.name}
              className="rounded-ss-sm"
              style={{ width: 20, height: 20, objectFit: 'cover' }}
            />
          ) : (
            <span>{getFileIcon(file)}</span>
          )}
          <span
            style={{
              maxWidth: '150px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </span>
        </a>
      ))}
    </span>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const FileEditor: React.FC<ColumnEditorProps<'file'>> = ({
  value,
  column: _column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const isMulti = Array.isArray(value);
  const files = value ? (Array.isArray(value) ? value : [value]) : [];

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles || selectedFiles.length === 0) return;

      const newFiles: FileAttachment[] = Array.from(selectedFiles).map((file, index) => ({
        id: `temp-${Date.now()}-${index}`,
        name: file.name,
        url: URL.createObjectURL(file),
        type: file.type,
        size: file.size,
      }));

      if (isMulti) {
        onChange([...files, ...newFiles]);
      } else {
        onChange(newFiles[0]);
      }
    },
    [files, isMulti, onChange],
  );

  const handleRemove = useCallback(
    (fileId: string) => {
      const newFiles = files.filter((f) => f.id !== fileId);
      if (isMulti) {
        onChange(newFiles.length > 0 ? newFiles : null);
      } else {
        onChange(null);
      }
    },
    [files, isMulti, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      }
    },
    [onCommit, onCancel],
  );

  return (
    <div className={`file-editor ${className}`} onKeyDown={handleKeyDown}>
      <div className="file-list flex gap-ss-1 flex-wrap mb-ss-2">
        {files.map((file) => (
          <span
            key={file.id}
            className="inline-flex items-center gap-ss-1 bg-ss-surface-secondary rounded-ss text-body-sm"
            style={{
              padding: '2px 8px',
            }}
          >
            <span>{getFileIcon(file)}</span>
            <span>{file.name}</span>
            <button
              type="button"
              onClick={() => handleRemove(file.id)}
              className="text-ss-text-disabled"
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                padding: '0 4px',
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple={isMulti}
        onChange={handleFileChange}
        disabled={disabled}
        className="text-body-sm"
      />

      <div className="mt-ss-2 flex gap-ss-2">
        <button type="button" onClick={onCommit}>
          Done
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const FileCardField: React.FC<CardFieldProps<'file'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  if (!value) {
    return null;
  }

  const files = Array.isArray(value) ? value : [value];

  if (files.length === 0) {
    return null;
  }

  if (compact) {
    // Show image preview or file count
    const firstImage = files.find(isPreviewableImage);
    if (firstImage && firstImage.thumbnailUrl) {
      return (
        <span className={`file-card-field compact ${className}`}>
          <img
            src={firstImage.thumbnailUrl}
            alt={firstImage.name}
            className="rounded-ss"
            style={{ width: 24, height: 24, objectFit: 'cover' }}
          />
          {files.length > 1 && (
            <span className="text-ss-text-secondary text-hint ml-ss-1">+{files.length - 1}</span>
          )}
        </span>
      );
    }

    return (
      <span className={`file-card-field compact ${className}`}>
        <span>{getFileIcon(files[0])}</span>
        {files.length > 1 && (
          <span className="text-ss-text-secondary text-hint ml-ss-1">+{files.length - 1}</span>
        )}
      </span>
    );
  }

  return (
    <span className={`file-card-field flex gap-ss-1 flex-wrap ${className}`}>
      {files.slice(0, 3).map((file) => (
        <span
          key={file.id}
          className="inline-flex items-center gap-ss-0_5 text-caption"
          title={file.name}
        >
          {isPreviewableImage(file) && file.thumbnailUrl ? (
            <img
              src={file.thumbnailUrl}
              alt={file.name}
              className="rounded-ss-sm"
              style={{ width: 20, height: 20, objectFit: 'cover' }}
            />
          ) : (
            <span>{getFileIcon(file)}</span>
          )}
        </span>
      ))}
      {files.length > 3 && (
        <span className="text-ss-text-secondary text-hint">+{files.length - 3}</span>
      )}
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const FileFormField: React.FC<FormFieldProps<'file'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  className = '',
}) => {
  const inputId = `form-field-${column.id}`;
  const isMulti = Array.isArray(value);
  const files = value ? (Array.isArray(value) ? value : [value]) : [];

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles || selectedFiles.length === 0) return;

      const newFiles: FileAttachment[] = Array.from(selectedFiles).map((file, index) => ({
        id: `temp-${Date.now()}-${index}`,
        name: file.name,
        url: URL.createObjectURL(file),
        type: file.type,
        size: file.size,
      }));

      if (isMulti) {
        onChange([...files, ...newFiles]);
      } else {
        onChange(newFiles[0]);
      }
    },
    [files, isMulti, onChange],
  );

  const handleRemove = useCallback(
    (fileId: string) => {
      const newFiles = files.filter((f) => f.id !== fileId);
      if (isMulti) {
        onChange(newFiles.length > 0 ? newFiles : null);
      } else {
        onChange(null);
      }
    },
    [files, isMulti, onChange],
  );

  return (
    <div className={`file-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <div className="file-list flex gap-ss-1 flex-wrap mb-ss-2">
        {files.map((file) => (
          <span
            key={file.id}
            className="inline-flex items-center gap-ss-1 bg-ss-surface-secondary rounded-ss text-body-sm"
            style={{
              padding: '4px 8px',
            }}
          >
            <span>{getFileIcon(file)}</span>
            <span>{file.name}</span>
            <span className="text-ss-text-tertiary text-hint">({formatFileSize(file.size)})</span>
            <button
              type="button"
              onClick={() => handleRemove(file.id)}
              disabled={disabled}
              className="text-ss-text-disabled"
              style={{
                border: 'none',
                background: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: '0 4px',
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <input
        id={inputId}
        type="file"
        multiple={isMulti}
        onChange={handleFileChange}
        disabled={disabled}
      />

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const FileRenderer: ColumnRenderer<'file'> = {
  render: renderFile,
  editor: FileEditor,
  cardField: FileCardField,
  formField: FileFormField,
};
