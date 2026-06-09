import * as vscode from 'vscode';
import type { ColorScheme, WebviewAssets } from './protocol.js';

export interface WebviewResourceUris {
  readonly scriptUri: vscode.Uri;
  readonly hostStylesUri: vscode.Uri;
  readonly spreadsheetStylesUri: vscode.Uri;
  readonly mediaBaseUri: vscode.Uri;
  readonly workerUri: vscode.Uri;
}

export function getWebviewResourceUris(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): WebviewResourceUris {
  const mediaBase = vscode.Uri.joinPath(extensionUri, 'media');
  return {
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaBase, 'webview.js')),
    hostStylesUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaBase, 'host.css')),
    spreadsheetStylesUri: webview.asWebviewUri(
      vscode.Uri.joinPath(mediaBase, 'spreadsheet-app.css'),
    ),
    mediaBaseUri: webview.asWebviewUri(mediaBase),
    workerUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaBase, 'worker.js')),
  };
}

export function getWebviewAssets(resources: WebviewResourceUris): WebviewAssets {
  const mediaBase = resources.mediaBaseUri.toString().replace(/\/?$/, '/');
  return {
    wasmBaseUrl: mediaBase,
    workerUrl: resources.workerUri.toString(),
    fontBaseUrl: `${mediaBase}assets/`,
    staticBaseUrl: mediaBase,
  };
}

export function getColorScheme(): ColorScheme {
  const themeKind = vscode.window.activeColorTheme.kind;
  if (
    themeKind === vscode.ColorThemeKind.Dark ||
    themeKind === vscode.ColorThemeKind.HighContrast
  ) {
    return 'dark';
  }
  if (
    themeKind === vscode.ColorThemeKind.Light ||
    themeKind === vscode.ColorThemeKind.HighContrastLight
  ) {
    return 'light';
  }
  return 'system';
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const resources = getWebviewResourceUris(webview, extensionUri);
  const cspSource = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: blob:; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; connect-src ${cspSource} data: blob:; worker-src ${cspSource} blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${resources.spreadsheetStylesUri}">
  <link rel="stylesheet" href="${resources.hostStylesUri}">
  <title>Mog Spreadsheet</title>
</head>
<body>
  <div id="root" data-mog-vscode-state="loading"></div>
  <script type="module" nonce="${nonce}" src="${resources.scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return text;
}
