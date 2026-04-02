# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension (`mekatrol-pydevice`) for developing with Python devices (MicroPython boards). It provides bidirectional file sync between computer and device storage, an interactive REPL window, a dual-tree explorer view, and device connection management over serial ports.

## Commands

```bash
npm run compile       # Type-check, lint, and bundle with esbuild (primary dev build)
npm run watch         # Watch mode for TypeScript + esbuild
npm run package       # Production build (minified, no sourcemap)
npm run check-types   # TypeScript type-check only
npm run lint          # ESLint on src/
npm run test          # Run VS Code test suite (via Mocha)
npm run arch:auto     # Generate dependency graph (SVG if Graphviz installed, else HTML)
npm run vsce:package  # Create .vsix package file
npm run vsce:publish  # Publish to VS Code Marketplace
```

Build output goes to `dist/extension.js` (CommonJS bundle). Webviews are copied to `dist/webviews/` during build.

## Architecture

### Activation & Entry Point

`src/extension.ts` activates on `onStartupFinished`, initializes the workspace cache, logger, file watcher, and registers all commands and views. Extension state flows from here outward.

### Core Layers

```
extension.ts (activation, DI root)
  ↓
commands/           ← Command handlers registered in package.json
views/              ← TreeView (Explorer) and WebView (REPL)
  ↓
devices/controller/ ← Discovers ports, manages device lifecycle, publishes state events
devices/registry/   ← In-memory store: active board connections, port-to-device map
devices/py-device.ts ← PyDevice: combines event model, state, connection
  ↓
devices/connection/ ← Low-level serial transport, raw REPL protocol
devices/discovery/  ← Serial port probing and device identification
  ↓
utils/              ← device-filesystem.ts, configuration.ts, sync helpers
sync/               ← Global sync state (independent of UI)
logging/            ← OutputChannelLogger + file watcher logging
```

### Key Data Flow

1. `PyDeviceController` discovers serial ports via `devices/discovery/`, creates `PyDevice` instances
2. `PyDevice` wraps `PyDeviceConnection` (serial transport + raw REPL) and emits state change events
3. `ConnectedDeviceRegistry` tracks live connections (port string → PyDevice map)
4. Commands in `commands/` use the registry to resolve the target device, then call into `devices/connection/`
5. Filesystem operations (`utils/device-filesystem.ts`) go over the REPL connection — listing, reading, writing device files
6. Configuration is loaded from `.pydevice/config.json` in the workspace (device mappings, library folders, exclusions)
7. Sync operations compare device vs computer filesystem state, stage diffs, then execute

### Device Connection

- `devices/connection/device-serial-port.ts` — raw SerialPort open/close
- `devices/connection/py-device-connection.ts` — REPL protocol: enter raw REPL mode, execute Python, capture output
- `devices/connection/` also handles auto-reconnect and aggressive recovery probing

### Configuration (`.pydevice/config.json`)

Per-workspace config read by `src/utils/configuration.ts`. Stores device-to-folder mappings, library folder paths, and sync exclusion patterns.

## Code Style

- **Prettier**: single quotes, 2-space indent, 200-char print width, semicolons required
- **ESLint**: flat config (`eslint.config.mjs`); unused variables must be prefixed with `_`; no bare `console.log` in production code (use `console.info/warn/error` or the logger)
- **TypeScript**: strict mode, ES2022 target, Node16 module resolution

## Key Timeouts (Configurable via VS Code Settings)

All under `mekatrol.pydevice.*`:
- `serialPortOperationTimeoutMs` — serial open/close (default: 3s)
- `pythonExecRawCaptureTimeoutMs` — Python command execution (default: 10s)
- `deviceFileOpenWaitForConnectionMs` — wait before device file ops fail (default: 120s)

## Testing

Tests live in `src/test/unit/` and run via the VS Code test harness (Mocha). Run with `npm run test`. The `pretest` script compiles, type-checks, and lints before running tests.

## Build Internals

`esbuild.js` bundles to CommonJS. `vscode`, `serialport`, `@serialport/*`, and `node-gyp-build` are externalized (not bundled). The `dist/` folder is gitignored and fully regenerated each build.
