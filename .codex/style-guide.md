# Codex Style Guide

## TypeScript

- Follow the existing TypeScript style: strict mode, ES2022 APIs, Node16 module resolution.
- Prefer existing local abstractions over new global helpers.
- Keep command registration close to existing command modules and keep activation wiring in `src/extension.ts` straightforward.
- Preserve the current event-driven shape around devices, registry updates, and UI refreshes.
- Use `vscode.workspace.fs` for VS Code workspace URIs and Node `fs` only where the existing code already works with local paths.
- Do not add broad catch-all behavior around device/serial operations without logging enough context to diagnose failures.
- Keep comments short and useful. The repo already uses file-level module overview comments; follow that pattern for new substantial modules.

## Formatting

- Single quotes.
- Semicolons.
- Two-space indentation.
- No trailing commas.
- Maximum line length is 200 characters.
- Unused variables or parameters must be prefixed with `_`.
- Production code should use the project logger or `console.info`, `console.warn`, `console.error`; bare `console.log` is warned in development and disallowed in production lint mode.

## UI And Webviews

- Prefer VS Code-native surfaces where possible: tree items, context menus, commands, quick picks, notifications, and webviews only where a richer interaction is needed.
- Keep webview assets static under `webviews/<view>/` and let `esbuild.js` copy them to `dist/webviews/`.
- Keep command IDs aligned between `package.json` contributions and implementation constants.
- Use context keys deliberately; many UI actions are controlled by `setContext` state.

## Configuration And State

- Shared workspace state belongs in `.pydevice/config.json`.
- Local/cache-like workspace state belongs in `.pydevice/settings.json`.
- Device mappings should remain relative to the workspace and must not point into `.pydevice`.
- Preserve compatibility with legacy configuration shapes unless an architecture change explicitly removes them.

## Testing

- For narrow logic changes, add or update unit tests under `src/test/unit/`.
- For serial/device lifecycle behavior, prefer tests around controller/registry boundaries unless physical hardware is required.
- Run at least `npm run check-types` and the narrowest relevant test command before handing off code changes.
- Use `npm run compile` when touching package contributions, activation wiring, webview asset loading, or build behavior.
