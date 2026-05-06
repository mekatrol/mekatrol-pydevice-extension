/**
 * Module overview:
 * Extension activation/deactivation entrypoint that wires up commands,
 * views, background services, and lifecycle cleanup.
 */
import * as vscode from 'vscode';
import { outputChannelLogger } from './logging/output-channel';
import { initCreateConfigCommand } from './commands/create-config-command';
import { initAutoDetectDevicesCommand } from './commands/auto-detect-devices-command';
import {
  closeAllConnectedPyDevices,
  initConnectBoardCommand,
  initConnectionStateMonitor,
  initRecoveryConnectCommand,
  initDisconnectBoardCommand,
  initShowDeviceConnectionViewCommand,
  initSoftRebootBoardCommand,
  initSetAutoReconnectCommand,
  initToggleBoardConnectionCommand,
  tryReconnectBoardOnStartup
} from './commands/connect-board-command';
import { initDeviceSyncExplorer } from './views/device-sync-explorer';
import { initDeviceMirrorDecorations } from './views/device-mirror-decorations';
import { initPyDeviceDebug } from './debug/py-device-debug';
import { initReplView } from './views/repl-view';
import { getWorkspaceCacheValue, initialiseWorkspaceCache, loggerAutoStartCacheKey } from './utils/workspace-cache';
import { initialisePyDeviceController, stopPyDeviceController } from './devices/controller/py-device-controller-singleton';
import { FileWatcher } from './utils/file-watcher';
import { disposePyDeviceLogger, initPyDeviceLogger, logPyDeviceLogger } from './logging/pydevice-logger';
import { initSetLoggerAutoStartCommand } from './commands/set-logger-autostart-command';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {
  // Initialise output channel for logging
  outputChannelLogger.init();
  outputChannelLogger.log('Mekatrol PyDevice activated...', false);

  const logStartup = (message: string, isError: boolean = false): void => {
    const line = `[PyDevice startup] ${message}`;
    if (isError) {
      console.error(line);
    } else {
      console.log(line);
    }
    outputChannelLogger.log(line, isError);
  };

  logStartup('Activation started.');
  logStartup(
    `Runtime: platform=${process.platform} arch=${process.arch} vscode=${vscode.version} node=${process.versions.node} electron=${process.versions.electron ?? 'unknown'}`
  );

  try {
    const serialportModule = await import('serialport');
    const hasSerialPortApi = typeof serialportModule.SerialPort?.list === 'function';
    logStartup(`serialport module load: ok (has SerialPort.list=${hasSerialPortApi ? 'yes' : 'no'})`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logStartup(`serialport module load: failed - ${reason}`, true);
  }

  await initialiseWorkspaceCache();

  let fileWatcherLoggerSubscription: vscode.Disposable | undefined;
  let fileWatcherOutputLogSubscription: vscode.Disposable | undefined;
  const setLoggerLiveState = (enabled: boolean): void => {
    if (enabled) {
      initPyDeviceLogger();
      if (!fileWatcherLoggerSubscription) {
        fileWatcherLoggerSubscription = fileWatcher.onDidLog((entry) => {
          logPyDeviceLogger(entry.message);
        });
      }
      logPyDeviceLogger('Mekatrol PyDevice activated.');
      return;
    }

    fileWatcherLoggerSubscription?.dispose();
    fileWatcherLoggerSubscription = undefined;
    disposePyDeviceLogger();
  };

  const fileWatcher = new FileWatcher({
    excludedPaths: ['.vscode', '.pydevice', 'device-mirror']
  });
  fileWatcherOutputLogSubscription = fileWatcher.onDidLog((entry) => {
    outputChannelLogger.log(entry.message, entry.isError);
  });
  fileWatcher.start();
  const loggerAutoStart = getWorkspaceCacheValue<boolean>(loggerAutoStartCacheKey) ?? true;
  setLoggerLiveState(loggerAutoStart);

  context.subscriptions.push(new vscode.Disposable(() => {
    fileWatcherLoggerSubscription?.dispose();
    fileWatcherLoggerSubscription = undefined;
    fileWatcherOutputLogSubscription?.dispose();
    fileWatcherOutputLogSubscription = undefined;
  }));
  context.subscriptions.push(fileWatcher);

  context.subscriptions.push({
    dispose: () => stopPyDeviceController()
  });

  const runInit = async (name: string, action: () => void | Promise<void>): Promise<void> => {
    logStartup(`${name}: start`);
    try {
      await action();
      logStartup(`${name}: ok`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logStartup(`${name}: failed - ${reason}`, true);
    }
  };

  // Create commands and views without allowing one failure to abort activation.
  await runInit('initCreateConfigCommand', () => initCreateConfigCommand(context));
  await runInit('initAutoDetectDevicesCommand', () => initAutoDetectDevicesCommand(context));
  await runInit('initConnectBoardCommand', () => initConnectBoardCommand(context));
  await runInit('initRecoveryConnectCommand', () => initRecoveryConnectCommand(context));
  await runInit('initShowDeviceConnectionViewCommand', () => initShowDeviceConnectionViewCommand(context));
  await runInit('initDisconnectBoardCommand', () => initDisconnectBoardCommand(context));
  await runInit('initSoftRebootBoardCommand', () => initSoftRebootBoardCommand(context));
  await runInit('initSetAutoReconnectCommand', () => initSetAutoReconnectCommand(context));
  await runInit('initSetLoggerAutoStartCommand', () => initSetLoggerAutoStartCommand(context, (enabled) => setLoggerLiveState(enabled)));
  await runInit('initToggleBoardConnectionCommand', () => initToggleBoardConnectionCommand(context));
  await runInit('initConnectionStateMonitor', () => initConnectionStateMonitor(context));
  await runInit('initReplView', () => initReplView(context));
  await runInit('tryReconnectBoardOnStartup', () => tryReconnectBoardOnStartup(context));
  await runInit('initialisePyDeviceController', async () => {
    await initialisePyDeviceController();
  });
  await runInit('initDeviceMirrorDecorations', () => {
    initDeviceMirrorDecorations(context);
  });

  await runInit('initDeviceSyncExplorer', () => initDeviceSyncExplorer(context, fileWatcher));

  // Init Run/Debug integration
  await runInit('initPyDeviceDebug', () => initPyDeviceDebug(context));

  logStartup('Activation completed.');
};

// This method is called when your extension is deactivated
export async function deactivate() {
  disposePyDeviceLogger();
  stopPyDeviceController();

  const hasDirtyDeviceDocuments = vscode.workspace.textDocuments.some(
    (document) => document.uri.scheme === 'pydevice-device' && document.isDirty
  );

  if (hasDirtyDeviceDocuments) {
    return;
  }

  await closeAllConnectedPyDevices(false, true, false, false);
}
