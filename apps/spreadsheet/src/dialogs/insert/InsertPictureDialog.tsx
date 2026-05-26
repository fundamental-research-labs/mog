/**
 * Insert Picture Dialog
 *
 * A dialog for inserting pictures into the spreadsheet.
 * Supports both file upload and URL input.
 *
 * Features:
 * - File upload (drag & drop or file picker)
 * - URL input for remote images
 * - Image preview
 * - Position/size controls (future)
 *
 */

import { useCallback, useRef, useState } from 'react';
import { useActiveSheetId, useUIStore } from '../../internal-api';
import { useWorkbook } from '../../infra/context';
import { blobToDataUrl } from '../../utils/blob-to-data-url';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
} from '@mog/shell';

// =============================================================================
// Types
// =============================================================================

interface InsertPictureDialogProps {
  /** Called when a picture is inserted */
  onInsert?: (objectId: string) => void;
}

type InputMode = 'file' | 'url';

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Validate image URL format.
 * Returns an error message if invalid, or null if valid.
 */
function validateImageUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return 'URL is required';
  }

  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return 'URL is required';
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
      return 'URL must use http or https';
    }
    return null; // Valid
  } catch {
    return 'Invalid URL format';
  }
}

// =============================================================================
// Component
// =============================================================================

export function InsertPictureDialog({ onInsert }: InsertPictureDialogProps) {
  const insertPictureDialog = useUIStore((s) => s.insertPictureDialog);
  const closeDialog = useUIStore((s) => s.closeInsertPictureDialog);
  const activeSheetId = useActiveSheetId();
  const workbook = useWorkbook();

  const { isOpen } = insertPictureDialog;

  // Local state
  const [mode, setMode] = useState<InputMode>('file');
  const [imageUrl, setImageUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  const resetState = useCallback(() => {
    setMode('file');
    setImageUrl('');
    setUrlError(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    setIsDragging(false);
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUrlError('Please select an image file');
      return;
    }

    setSelectedFile(file);
    setUrlError(null);

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }, []);

  // Handle file input change
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  // Handle URL change
  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      setImageUrl(newUrl);
      if (urlError) {
        setUrlError(null);
      }

      // Update preview if URL looks valid
      if (newUrl.startsWith('http://') || newUrl.startsWith('https://')) {
        setPreviewUrl(newUrl);
      } else {
        setPreviewUrl(null);
      }
    },
    [urlError],
  );

  // Handle OK button click
  const handleOk = useCallback(async () => {
    let imageSource: string;

    if (mode === 'url') {
      const validationError = validateImageUrl(imageUrl);
      if (validationError) {
        setUrlError(validationError);
        return;
      }
      imageSource = imageUrl.trim();
    } else if (selectedFile) {
      // Convert file to data URL for storage
      imageSource = await blobToDataUrl(selectedFile);
    } else {
      setUrlError('Please select an image or enter a URL');
      return;
    }

    // Create the picture object via the Worksheet API
    const ws = workbook.getSheetById(activeSheetId);
    const pictureHandle = await ws.pictures.add({
      src: imageSource,
      // Default position - center of viewport
      x: 100,
      y: 100,
      width: 200,
      height: 150,
    });

    onInsert?.(pictureHandle.id);
    closeDialog();
    resetState();
  }, [mode, imageUrl, selectedFile, workbook, activeSheetId, onInsert, closeDialog, resetState]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
    resetState();
  }, [closeDialog, resetState]);

  // Check if we can insert
  const canInsert = mode === 'url' ? imageUrl.trim().length > 0 : selectedFile !== null;

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={handleCancel}
      dialogId="insert-picture-dialog"
      width={500}
      onEnterKeyDown={() => {
        void handleOk();
      }}
    >
      <DialogHeader onClose={handleCancel}>Insert Picture</DialogHeader>

      <DialogBody>
        {/* Tab Bar */}
        <div className="flex border-b border-ss-border mb-4">
          <button
            type="button"
            className={`px-4 py-2 cursor-pointer border-none bg-transparent text-tab font-medium border-b-2 transition-all ${
              mode === 'file'
                ? 'text-ss-primary border-b-primary'
                : 'text-ss-text-secondary border-b-transparent'
            }`}
            onClick={() => setMode('file')}
          >
            Upload
          </button>
          <button
            type="button"
            className={`px-4 py-2 cursor-pointer border-none bg-transparent text-tab font-medium border-b-2 transition-all ${
              mode === 'url'
                ? 'text-ss-primary border-b-primary'
                : 'text-ss-text-secondary border-b-transparent'
            }`}
            onClick={() => setMode('url')}
          >
            From URL
          </button>
        </div>

        {mode === 'file' ? (
          <>
            {/* Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-ss-lg p-8 text-center cursor-pointer transition-all mb-4 ${
                isDragging ? 'border-ss-primary bg-ss-primary/5' : 'border-ss-border'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="text-body-sm text-ss-text-secondary mb-2">
                Drag and drop an image here, or{' '}
                <span className="text-ss-primary cursor-pointer">browse files</span>
              </div>
              <div className="text-caption text-ss-text-tertiary">Supports: PNG, JPG, GIF, SVG</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInputChange}
            />
          </>
        ) : (
          /* URL Input */
          <FormField label="Image URL" error={urlError ?? undefined} htmlFor="picture-url">
            <Input
              id="picture-url"
              type="text"
              value={imageUrl}
              onChange={handleUrlChange}
              placeholder="https://example.com/image.png"
              error={!!urlError}
              autoFocus
            />
          </FormField>
        )}

        {/* Preview */}
        {previewUrl && (
          <div className="mt-4 p-4 bg-ss-surface-secondary rounded-ss-lg text-center">
            <img
              src={previewUrl}
              alt="Preview"
              className="max-w-full max-h-[200px] rounded"
              onError={() => {
                if (mode === 'url') {
                  setUrlError('Could not load image from URL');
                  setPreviewUrl(null);
                }
              }}
            />
            {selectedFile && (
              <div className="text-body-sm text-ss-text-secondary mt-2 break-all">
                {selectedFile.name}
              </div>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!canInsert}>
          Insert
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
