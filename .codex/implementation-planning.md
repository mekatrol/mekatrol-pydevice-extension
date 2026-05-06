# Implementation Planning Notes

Use this file as the starting point for the upcoming application approach and architecture change.

## Current Architecture Baseline

- `src/extension.ts` is a large composition root that starts logging, workspace cache, file watching, command registration, views, reconnect, controller startup, and debug integration.
- Device lifecycle flows through `PyDeviceController`, `ConnectedDeviceRegistry`, `PyDevice`, and `PyDeviceConnection`.
- The sync explorer is currently the largest surface and combines tree model, command handlers, sync preview, virtual filesystem provider, and device info webview behavior in one module.
- Workspace config and local cache are separate files under `.pydevice/`.
- UI is mostly VS Code tree/context-menu driven, with static webviews for richer dialogs/panels.

## Planning Questions To Resolve

- What is the desired top-level user workflow: project-first, device-first, or explicit session/workspace model?
- Should sync become a service with a small UI adapter, instead of living mostly in the explorer module?
- Should device connection, identity, reconnect, and serial probing be split behind a single application service boundary?
- Should webviews remain static hand-written assets or move to a typed build pipeline?
- What state is shared project configuration, what is local workspace cache, and what belongs in VS Code global/workspaceState?
- Which behaviors must remain backward compatible with existing `.pydevice/config.json` files?

## Suggested Planning Output

- Target user flows.
- Proposed module boundaries.
- State ownership table.
- Migration plan for existing config/cache files.
- Test strategy by layer.
- Incremental implementation phases with rollback points.
