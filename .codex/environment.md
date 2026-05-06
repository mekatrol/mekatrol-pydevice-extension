# Codex Environment

This repository is a VS Code extension named `mekatrol-pydevice`.

## Runtime

- Extension host target: VS Code `^1.98.0`.
- Language: TypeScript, compiled with `tsc` and bundled with `esbuild`.
- Module output: CommonJS bundle at `dist/extension.js`.
- Node packages are managed with npm and locked in `package-lock.json`.
- Hardware integration uses `serialport` and VS Code APIs.

## Project Shape

- `src/extension.ts` is the activation root and command/view wiring point.
- `src/commands/` contains command registration and command handlers.
- `src/views/` contains the REPL webview, sync explorer, and mirror decorations.
- `src/devices/controller/` owns discovery and device lifecycle orchestration.
- `src/devices/registry/` tracks connected devices and reconnect state.
- `src/devices/connection/` owns serial transport and raw REPL interaction.
- `src/devices/discovery/` probes serial devices and identifies runtime info.
- `src/utils/configuration.ts` persists workspace config in `.pydevice/config.json`.
- `src/utils/workspace-cache.ts` persists local workspace settings in `.pydevice/settings.json`.
- `src/utils/device-filesystem.ts` handles device filesystem scanning, mirror roots, and sync operations.
- `src/sync/sync-state-store.ts` stores sync state independent of UI.
- `webviews/` contains static HTML/CSS/JS assets copied into `dist/webviews/`.
- `src/test/unit/` and `src/test/integration/` contain Mocha tests compiled into `out/`.

## Architecture Flow

```text
extension.ts
  -> commands/ and views/
  -> devices/controller/ and devices/registry/
  -> devices/py-device.ts
  -> devices/connection/ and devices/discovery/
  -> utils/, sync/, logging/
```

- `src/extension.ts` activates on startup, initializes workspace cache, logging, file watching, commands, views, reconnect handling, controller startup, and debug integration.
- `PyDeviceController` discovers serial ports through `devices/discovery/` and creates `PyDevice` instances.
- `PyDevice` wraps `PyDeviceConnection`, combines event/state behavior, and emits connection state changes.
- `ConnectedDeviceRegistry` tracks live connections and maps ports to devices.
- Command handlers resolve target devices through the registry, then call the device/connection layer.
- Device filesystem operations go through the raw REPL connection for listing, reading, and writing files.
- Sync operations compare device and computer filesystem state, stage operations, show previews, then execute selected operations.

## Important Workspace Files

- `.pydevice/config.json`: shared PyDevice workspace config. It stores per-device mappings, display names, library folders, and sync exclusions.
- `.pydevice/settings.json`: local workspace cache. It stores reconnect state, logger autostart, REPL history, and timeout values.
- `device-mirror/`: managed mirror root for device-backed files. Code treats conflicts at this path specially.

## Build And Test Commands

- `npm run check-types`: TypeScript type check.
- `npm run lint`: type check plus ESLint over `src`.
- `npm run compile`: type check, lint, and development bundle.
- `npm run package`: type check, lint, and production bundle.
- `npm run compile-tests`: compile tests to `out`.
- `npm run test`: run the VS Code test harness.
- `npm run test:integration`: run compiled integration tests with Mocha.
- `npm run arch:auto`: generate the dependency graph as SVG when Graphviz is available, otherwise HTML.
- `npm run vsce:package`: build a VSIX package.
- `npm run install:local`: install the latest local VSIX using `scripts/install-local-vsix.js`.

## Build Internals

- `esbuild.js` bundles the extension to `dist/extension.js`.
- `vscode`, `serialport`, `@serialport/*`, and `node-gyp-build` are externalized by the build.
- Webview assets are copied to `dist/webviews/`.
- `dist/` and `out/` are generated build/test outputs and are gitignored.

## Key Configurable Timeouts

All timeout settings are contributed under `mekatrol.pydevice.*`.

- `serialPortOperationTimeoutMs`: serial open/close operations.
- `serialPortAggressiveRecoveryProbeTimeoutMs`: post-failure recovery probing.
- `pythonProbeRuntimeInfoTimeoutMs`: lightweight runtime probing.
- `pythonGetRuntimeInfoTimeoutMs`: full runtime info reads.
- `pythonExecRawCaptureTimeoutMs`: raw REPL Python command execution.
- `pythonSoftRebootTimeoutMs`: soft reboot sequences.
- `pythonHardRebootTimeoutMs`: hard reboot waits around DTR/RTS or close/reopen restart paths.
- `pythonSerialWriteAckTimeoutMs`: serial write acknowledgement and drain completion.
- `deviceFileOpenWaitForConnectionMs`: wait before device file open/save operations fail.

## Development Notes

- The extension activates on `onStartupFinished` and `onFileSystem:pydevice-device`.
- Many command palette entries are intentionally hidden and surfaced through tree/context menus.
- Device operations may require real serial hardware; unit tests are the safest default verification path for most code changes.
- Avoid changing generated output in `dist/` or `out/` unless the task explicitly involves packaging artifacts.
- `node_modules/` is present in this workspace but should be ignored during code searches and edits.
