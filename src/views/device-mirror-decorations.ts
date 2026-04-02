import * as vscode from 'vscode';
import {
  configurationFileName,
  deviceMirrorDirectoryName,
  getDeviceNames,
  loadConfiguration,
  onPyDeviceConfigurationUpdated
} from '../utils/configuration';

const normaliseRelativePath = (value: string): string => value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

class DeviceMirrorDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private deviceNames: Record<string, string> = {};

  constructor() {
    this.disposables.push(onPyDeviceConfigurationUpdated((configuration) => {
      this.deviceNames = getDeviceNames(configuration);
      this.onDidChangeFileDecorationsEmitter.fire(undefined);
    }));
    this.disposables.push(vscode.workspace.onDidSaveTextDocument((document) => {
      const relativePath = normaliseRelativePath(vscode.workspace.asRelativePath(document.uri, false));
      if (relativePath === configurationFileName) {
        void this.reload();
      }
    }));
    void this.reload();
  }

  dispose(): void {
    this.onDidChangeFileDecorationsEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  async reload(): Promise<void> {
    const configuration = await loadConfiguration();
    this.deviceNames = getDeviceNames(configuration);
    this.onDidChangeFileDecorationsEmitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const deviceId = this.getMirrorDeviceId(uri);
    if (!deviceId) {
      return undefined;
    }

    const name = this.deviceNames[deviceId]?.trim();
    if (!name) {
      return undefined;
    }

    return {
      tooltip: `[${name}]`
    };
  }

  private getMirrorDeviceId(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }

    const relativePath = normaliseRelativePath(vscode.workspace.asRelativePath(uri, false));
    if (!relativePath) {
      return undefined;
    }

    const segments = relativePath.split('/');
    const mirrorSegments = normaliseRelativePath(deviceMirrorDirectoryName).split('/');
    if (segments.length !== mirrorSegments.length + 1) {
      return undefined;
    }

    for (let index = 0; index < mirrorSegments.length; index += 1) {
      if (segments[index] !== mirrorSegments[index]) {
        return undefined;
      }
    }

    const deviceId = segments[segments.length - 1]?.trim();
    return deviceId && deviceId.length > 0 ? deviceId : undefined;
  }
}

export const initDeviceMirrorDecorations = (context: vscode.ExtensionContext): void => {
  const provider = new DeviceMirrorDecorationProvider();
  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));
};
