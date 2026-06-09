import * as vscode from 'vscode';
import type { ByteResultPayload, SaveResultPayload } from './protocol.js';

export interface MogXlsxWebviewController {
  postInit(bytes?: Uint8Array): Promise<void>;
  queueSaveBytesForNextSave(save: SaveResultPayload): () => boolean;
  requestSaveBytes(token?: vscode.CancellationToken): Promise<SaveResultPayload>;
  requestBackupBytes(token?: vscode.CancellationToken): Promise<ByteResultPayload>;
  requestExportXlsxBytes(token?: vscode.CancellationToken): Promise<ByteResultPayload>;
  postSaveAck(requestId: string, versionId?: string): Promise<void>;
  postSaveFailed(requestId: string, message: string): Promise<void>;
  setTheme(): Promise<void>;
  dispose(): void;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export class MogXlsxDocument implements vscode.CustomDocument {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
  private sourceBytesValue: Uint8Array;
  private dirtyValue = false;
  private versionValue = 0;
  private changeSequenceValue = 0;
  private controllerValue: MogXlsxWebviewController | null = null;
  private suppressExternalChangesUntil = 0;

  readonly onDidDispose = this.onDidDisposeEmitter.event;

  private constructor(
    readonly uri: vscode.Uri,
    sourceBytes: Uint8Array,
    readonly restoredFromBackupUri?: vscode.Uri,
  ) {
    this.sourceBytesValue = cloneBytes(sourceBytes);
    this.disposables.push(this.onDidDisposeEmitter);
  }

  static async create(
    uri: vscode.Uri,
    backupId: string | undefined,
    token: vscode.CancellationToken,
  ): Promise<MogXlsxDocument> {
    const sourceUri = backupId ? vscode.Uri.parse(backupId) : uri;
    const sourceBytes = await vscode.workspace.fs.readFile(sourceUri);
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    return new MogXlsxDocument(uri, sourceBytes, backupId ? sourceUri : undefined);
  }

  get sourceBytes(): Uint8Array {
    return cloneBytes(this.sourceBytesValue);
  }

  get dirty(): boolean {
    return this.dirtyValue;
  }

  get version(): number {
    return this.versionValue;
  }

  get changeSequence(): number {
    return this.changeSequenceValue;
  }

  get controller(): MogXlsxWebviewController | null {
    return this.controllerValue;
  }

  attachController(controller: MogXlsxWebviewController): void {
    this.controllerValue?.dispose();
    this.controllerValue = controller;
  }

  requireController(): MogXlsxWebviewController {
    if (!this.controllerValue) {
      throw new Error('Mog XLSX editor webview is not attached');
    }
    return this.controllerValue;
  }

  markDirty(changeSequence: number): boolean {
    const wasDirty = this.dirtyValue;
    this.dirtyValue = true;
    this.changeSequenceValue = Math.max(this.changeSequenceValue, changeSequence);
    return !wasDirty;
  }

  markCleanFromWebview(changeSequence: number): void {
    this.dirtyValue = false;
    this.changeSequenceValue = Math.max(this.changeSequenceValue, changeSequence);
  }

  replaceSourceBytes(bytes: Uint8Array, options: { dirty: boolean }): void {
    this.sourceBytesValue = cloneBytes(bytes);
    this.dirtyValue = options.dirty;
    this.versionValue += 1;
  }

  markSaved(bytes: Uint8Array): string {
    this.replaceSourceBytes(bytes, { dirty: false });
    this.suppressExternalChangesUntil = Date.now() + 1500;
    return `v${this.versionValue}`;
  }

  shouldIgnoreExternalFileEvent(): boolean {
    return Date.now() < this.suppressExternalChangesUntil;
  }

  dispose(): void {
    this.controllerValue?.dispose();
    this.controllerValue = null;
    this.onDidDisposeEmitter.fire();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
