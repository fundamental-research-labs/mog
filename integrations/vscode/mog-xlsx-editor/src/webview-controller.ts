import * as path from 'node:path';
import * as vscode from 'vscode';
import { MogXlsxDocument } from './mog-xlsx-document.js';
import {
  bytesToNumberArray,
  isValidRequestId,
  numberArrayToBytes,
  parseWebviewMessage,
  type ByteResultPayload,
  type ExtensionToWebview,
  type SaveResultPayload,
  type WebviewToExtension,
} from './protocol.js';
import {
  getColorScheme,
  getWebviewAssets,
  getWebviewHtml,
  getWebviewResourceUris,
} from './webview-html.js';

type PendingRequest = {
  readonly expectedType: 'save-result' | 'backup-result' | 'export-result';
  readonly resolve: (value: SaveResultPayload | ByteResultPayload) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
  readonly cancellation?: vscode.Disposable;
};

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function requestId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}

export class MogXlsxWebviewPanelController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly ready = createDeferred<void>();
  private queuedSave: SaveResultPayload | null = null;
  private disposed = false;
  private initializedDocumentId: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: MogXlsxDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly onDirty: (document: MogXlsxDocument) => void,
    private readonly onInitialized: (document: MogXlsxDocument) => void,
    private readonly onHostSaveRequest: (
      document: MogXlsxDocument,
      save: SaveResultPayload,
    ) => Promise<void>,
  ) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    };
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(
            `Mog Spreadsheet message handling failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  async postInit(bytes = this.document.sourceBytes): Promise<void> {
    await this.whenReady();
    const resources = getWebviewResourceUris(this.panel.webview, this.context.extensionUri);
    const message: ExtensionToWebview = {
      type: 'init',
      documentId: this.documentId(),
      fileName: path.basename(this.document.uri.fsPath),
      bytes: bytesToNumberArray(bytes),
      assets: getWebviewAssets(resources),
      colorScheme: getColorScheme(),
    };
    await this.post(message);
  }

  async requestSaveBytes(token?: vscode.CancellationToken): Promise<SaveResultPayload> {
    const queued = this.queuedSave;
    if (queued) {
      this.queuedSave = null;
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      return queued;
    }

    const payload = await this.requestBytes('request-save', 'save-result', token);
    return payload as SaveResultPayload;
  }

  queueSaveBytesForNextSave(save: SaveResultPayload): () => boolean {
    this.queuedSave = {
      ...save,
      bytes: bytesToNumberArray(numberArrayToBytes(save.bytes)),
    };
    return () => {
      if (this.queuedSave?.requestId !== save.requestId) return false;
      this.queuedSave = null;
      return true;
    };
  }

  async requestBackupBytes(token?: vscode.CancellationToken): Promise<ByteResultPayload> {
    const payload = await this.requestBytes('request-backup', 'backup-result', token);
    return payload as ByteResultPayload;
  }

  async requestExportXlsxBytes(token?: vscode.CancellationToken): Promise<ByteResultPayload> {
    const payload = await this.requestBytes('request-export-xlsx', 'export-result', token);
    return payload as ByteResultPayload;
  }

  async postSaveAck(requestIdValue: string, versionId?: string): Promise<void> {
    await this.post({ type: 'save-ack', requestId: requestIdValue, versionId });
  }

  async postSaveFailed(requestIdValue: string, message: string): Promise<void> {
    await this.post({ type: 'save-failed', requestId: requestIdValue, message });
  }

  async setTheme(): Promise<void> {
    if (!this.isReadyForPost()) return;
    await this.post({ type: 'set-theme', colorScheme: getColorScheme() });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queuedSave = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.cancellation?.dispose();
      pending.reject(new Error(`Webview disposed before ${id} completed`));
    }
    this.pending.clear();
    void this.panel.webview.postMessage({ type: 'dispose' } satisfies ExtensionToWebview);
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async requestBytes(
    requestType: 'request-save' | 'request-backup' | 'request-export-xlsx',
    expectedType: PendingRequest['expectedType'],
    token?: vscode.CancellationToken,
  ): Promise<SaveResultPayload | ByteResultPayload> {
    await this.whenReady();
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    const id = requestId(requestType);
    const message = { type: requestType, requestId: id } satisfies ExtensionToWebview;
    return new Promise<SaveResultPayload | ByteResultPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        cancellation?.dispose();
        reject(new Error(`Timed out waiting for ${expectedType}`));
      }, 60000);
      const cancellation = token?.onCancellationRequested(() => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new vscode.CancellationError());
      });
      this.pending.set(id, { expectedType, resolve, reject, timeout, cancellation });
      void this.post(message).catch((error: unknown) => {
        clearTimeout(timeout);
        cancellation?.dispose();
        this.pending.delete(id);
        reject(toError(error));
      });
    });
  }

  private async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseWebviewMessage(rawMessage);
    if (!message) {
      await vscode.window.showWarningMessage('Mog Spreadsheet ignored an invalid webview message.');
      return;
    }

    switch (message.type) {
      case 'ready':
        this.ready.resolve();
        await this.postInit();
        return;
      case 'initialized':
        this.initializedDocumentId = message.documentId;
        this.onInitialized(this.document);
        return;
      case 'dirty-change':
        if (message.dirty) {
          if (this.document.markDirty(message.changeSequence)) {
            this.onDirty(this.document);
          }
        } else {
          this.document.markCleanFromWebview(message.changeSequence);
        }
        return;
      case 'save-result':
      case 'backup-result':
      case 'export-result':
        await this.resolvePending(message);
        return;
      case 'error':
        if (message.requestId) {
          this.rejectPending(message.requestId, new Error(message.message));
        }
        await vscode.window.showErrorMessage(
          `Mog Spreadsheet ${message.operation} failed: ${message.message}`,
        );
        return;
    }
  }

  private async resolvePending(
    message: Extract<
      WebviewToExtension,
      { type: 'save-result' | 'backup-result' | 'export-result' }
    >,
  ): Promise<void> {
    if (!isValidRequestId(message.requestId)) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      if (message.type === 'save-result') {
        await this.onHostSaveRequest(this.document, {
          ...message,
          bytes: bytesToNumberArray(numberArrayToBytes(message.bytes)),
        });
      }
      return;
    }
    if (pending.expectedType !== message.type) {
      this.rejectPending(
        message.requestId,
        new Error(`Expected ${pending.expectedType}, received ${message.type}`),
      );
      return;
    }
    clearTimeout(pending.timeout);
    pending.cancellation?.dispose();
    this.pending.delete(message.requestId);
    if (message.type === 'save-result') {
      pending.resolve({
        ...message,
        bytes: bytesToNumberArray(numberArrayToBytes(message.bytes)),
      });
    } else {
      pending.resolve({
        requestId: message.requestId,
        bytes: bytesToNumberArray(numberArrayToBytes(message.bytes)),
        bytesHash: message.bytesHash,
      });
    }
  }

  private rejectPending(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.cancellation?.dispose();
    this.pending.delete(id);
    pending.reject(error);
  }

  private async post(message: ExtensionToWebview): Promise<void> {
    if (this.disposed) throw new Error('Cannot post to disposed Mog XLSX webview');
    const accepted = await this.panel.webview.postMessage(message);
    if (!accepted) throw new Error(`Mog XLSX webview rejected ${message.type}`);
  }

  private async whenReady(): Promise<void> {
    if (this.disposed) throw new Error('Mog XLSX webview is disposed');
    await this.ready.promise;
  }

  private isReadyForPost(): boolean {
    return !this.disposed && this.initializedDocumentId !== null;
  }

  private documentId(): string {
    const raw = `${this.document.uri.toString()}@${this.document.version}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = (hash * 31 + raw.charCodeAt(i)) | 0;
    }
    return `vscode-${Math.abs(hash).toString(36)}-${this.document.version}`;
  }
}
