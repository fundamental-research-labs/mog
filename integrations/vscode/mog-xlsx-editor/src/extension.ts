import * as vscode from 'vscode';
import { MogXlsxDocument } from './mog-xlsx-document.js';
import { MogXlsxWebviewPanelController } from './webview-controller.js';
import { numberArrayToBytes } from './protocol.js';

const VIEW_TYPE = 'mog.xlsxEditor';

function uriKey(uri: vscode.Uri): string {
  return uri.toString();
}

function cancellationErrorIfNeeded(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(MogXlsxEditorProvider.register(context));
}

export function deactivate(): void {
  // VS Code disposes provider subscriptions registered from activate().
}

class MogXlsxEditorProvider implements vscode.CustomEditorProvider<MogXlsxDocument> {
  private readonly onDidChangeCustomDocumentEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<MogXlsxDocument>
  >();
  readonly onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;

  private readonly documents = new Map<string, MogXlsxDocument>();
  private readonly initializedDocuments = new Set<string>();
  private readonly readyWaiters = new Map<
    string,
    Array<{
      readonly resolve: (state: DocumentState) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: NodeJS.Timeout;
    }>
  >();
  private readonly disposables: vscode.Disposable[] = [this.onDidChangeCustomDocumentEmitter];

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new MogXlsxEditorProvider(context);
    const registration = vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    });
    return vscode.Disposable.from(provider, registration);
  }

  private constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.xlsx');
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => void this.handleExternalChange(uri)),
      watcher.onDidCreate((uri) => void this.handleExternalChange(uri)),
      watcher.onDidDelete((uri) => void this.handleExternalDelete(uri)),
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        for (const document of this.documents.values()) {
          void document.controller?.setTheme();
        }
      }),
      vscode.commands.registerCommand(
        'mog.xlsxEditor.test.waitForReady',
        (uri: string, timeoutMs?: number) => this.waitForReady(uri, timeoutMs),
      ),
      vscode.commands.registerCommand(
        'mog.xlsxEditor.test.waitForDirty',
        (uri: string, dirty: boolean, timeoutMs?: number) =>
          this.waitForDirty(uri, dirty, timeoutMs),
      ),
      vscode.commands.registerCommand(
        'mog.xlsxEditor.test.writeBackup',
        (uri: string, destination: string) => this.writeTestBackup(uri, destination),
      ),
    );
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken,
  ): Promise<MogXlsxDocument> {
    const document = await MogXlsxDocument.create(uri, openContext.backupId, token);
    this.documents.set(uriKey(uri), document);
    this.disposables.push(
      document.onDidDispose(() => {
        this.documents.delete(uriKey(uri));
        this.initializedDocuments.delete(uriKey(uri));
      }),
    );
    return document;
  }

  async resolveCustomEditor(
    document: MogXlsxDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    cancellationErrorIfNeeded(token);
    const controller = new MogXlsxWebviewPanelController(
      this.context,
      document,
      webviewPanel,
      (dirtyDocument) => this.onDidChangeCustomDocumentEmitter.fire({ document: dirtyDocument }),
      (readyDocument) => this.markInitialized(readyDocument),
      (hostSaveDocument, save) => this.writeHostInitiatedSave(hostSaveDocument, save),
    );
    document.attachController(controller);
  }

  async saveCustomDocument(
    document: MogXlsxDocument,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const controller = document.requireController();
    const save = await controller.requestSaveBytes(token);
    cancellationErrorIfNeeded(token);
    const bytes = numberArrayToBytes(save.bytes);
    try {
      await vscode.workspace.fs.writeFile(document.uri, bytes);
      const versionId = document.markSaved(bytes);
      await controller.postSaveAck(save.requestId, versionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await controller.postSaveFailed(save.requestId, message);
      throw error;
    }
  }

  async saveCustomDocumentAs(
    document: MogXlsxDocument,
    destination: vscode.Uri,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const controller = document.requireController();
    const save = await controller.requestSaveBytes(token);
    cancellationErrorIfNeeded(token);
    const bytes = numberArrayToBytes(save.bytes);
    try {
      await vscode.workspace.fs.writeFile(destination, bytes);
      const versionId = document.markSaved(bytes);
      await controller.postSaveAck(save.requestId, versionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await controller.postSaveFailed(save.requestId, message);
      throw error;
    }
  }

  async revertCustomDocument(
    document: MogXlsxDocument,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    cancellationErrorIfNeeded(token);
    document.replaceSourceBytes(bytes, { dirty: false });
    await document.controller?.postInit(bytes);
  }

  async backupCustomDocument(
    document: MogXlsxDocument,
    context: vscode.CustomDocumentBackupContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    const result = document.controller
      ? await document.controller.requestBackupBytes(token)
      : { bytes: Array.from(document.sourceBytes) };
    cancellationErrorIfNeeded(token);
    const bytes = numberArrayToBytes(result.bytes);
    await vscode.workspace.fs.writeFile(context.destination, bytes);
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // VS Code treats backup deletion as best-effort cleanup.
        }
      },
    };
  }

  dispose(): void {
    for (const waiters of this.readyWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error('Mog XLSX editor provider disposed before readiness'));
      }
    }
    this.readyWaiters.clear();
    for (const document of this.documents.values()) {
      document.dispose();
    }
    this.documents.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async handleExternalChange(uri: vscode.Uri): Promise<void> {
    const document = this.documents.get(uriKey(uri));
    if (!document || document.shouldIgnoreExternalFileEvent()) return;
    if (document.dirty) {
      await vscode.window.showWarningMessage(
        `The XLSX file changed on disk while Mog Spreadsheet has unsaved edits: ${uri.fsPath}`,
      );
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      document.replaceSourceBytes(bytes, { dirty: false });
      await document.controller?.postInit(bytes);
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Mog Spreadsheet could not reload changed XLSX file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async handleExternalDelete(uri: vscode.Uri): Promise<void> {
    const document = this.documents.get(uriKey(uri));
    if (!document || document.shouldIgnoreExternalFileEvent()) return;
    if (document.dirty) {
      await vscode.window.showWarningMessage(
        `The XLSX file was deleted on disk while Mog Spreadsheet has unsaved edits: ${uri.fsPath}`,
      );
    }
  }

  private async writeHostInitiatedSave(
    document: MogXlsxDocument,
    save: import('./protocol.js').SaveResultPayload,
  ): Promise<void> {
    const controller = document.requireController();
    const bytes = numberArrayToBytes(save.bytes);
    try {
      await vscode.workspace.fs.writeFile(document.uri, bytes);
      const versionId = document.markSaved(bytes);
      await controller.postSaveAck(save.requestId, versionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await controller.postSaveFailed(save.requestId, message);
      throw error;
    }
  }

  private markInitialized(document: MogXlsxDocument): void {
    const key = uriKey(document.uri);
    this.initializedDocuments.add(key);
    const waiters = this.readyWaiters.get(key) ?? [];
    this.readyWaiters.delete(key);
    const state = this.documentState(document);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(state);
    }
  }

  private waitForReady(uriString: string, timeoutMs = 60000): Promise<DocumentState> {
    const uri = vscode.Uri.parse(uriString);
    const key = uriKey(uri);
    const document = this.documents.get(key);
    if (document && this.initializedDocuments.has(key)) {
      return Promise.resolve(this.documentState(document));
    }
    return new Promise<DocumentState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiters = this.readyWaiters.get(key)?.filter((waiter) => waiter.reject !== reject);
        if (waiters && waiters.length > 0) {
          this.readyWaiters.set(key, waiters);
        } else {
          this.readyWaiters.delete(key);
        }
        reject(new Error(`Timed out waiting for Mog XLSX editor readiness: ${uriString}`));
      }, timeoutMs);
      const waiters = this.readyWaiters.get(key) ?? [];
      waiters.push({ resolve, reject, timeout });
      this.readyWaiters.set(key, waiters);
    });
  }

  private waitForDirty(
    uriString: string,
    dirty: boolean,
    timeoutMs = 60000,
  ): Promise<DocumentState> {
    const uri = vscode.Uri.parse(uriString);
    const key = uriKey(uri);
    const started = Date.now();
    return new Promise<DocumentState>((resolve, reject) => {
      const check = () => {
        const document = this.documents.get(key);
        if (document && document.dirty === dirty) {
          resolve(this.documentState(document));
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for dirty=${dirty}: ${uriString}`));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  private documentState(document: MogXlsxDocument): DocumentState {
    return {
      uri: document.uri.toString(),
      dirty: document.dirty,
      version: document.version,
      changeSequence: document.changeSequence,
    };
  }

  private async writeTestBackup(
    uriString: string,
    destinationPath: string,
  ): Promise<DocumentState & { readonly backupId: string }> {
    const uri = vscode.Uri.parse(uriString);
    const document = this.documents.get(uriKey(uri));
    if (!document) throw new Error(`No Mog XLSX document is open for ${uriString}`);
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const backup = await this.backupCustomDocument(
        document,
        { destination: vscode.Uri.file(destinationPath) } as vscode.CustomDocumentBackupContext,
        tokenSource.token,
      );
      return { ...this.documentState(document), backupId: backup.id };
    } finally {
      tokenSource.dispose();
    }
  }
}

type DocumentState = {
  readonly uri: string;
  readonly dirty: boolean;
  readonly version: number;
  readonly changeSequence: number;
};
