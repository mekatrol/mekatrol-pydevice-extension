# Setup, Build, and Publish

This guide combines environment setup, build commands, and extension publishing workflows.

## 1) Setup

### Prerequisites

- Node.js + npm
- VS Code (`code` CLI available in PATH) for local VSIX install/testing
- Graphviz (`dot` command) only if generating architecture SVG diagrams

### Windows setup

1. Install Node.js (includes npm):

```powershell
winget install OpenJS.NodeJS.LTS
```

2. Install Graphviz (for `arch:svg` output):

```powershell
winget install Graphviz.Graphviz
```

3. Reopen terminal, then install project dependencies:

```powershell
npm install
```

4. Verify Graphviz:

```powershell
dot -V
```

5. If `dot -V` fails, locate and add `dot.exe` to user PATH:

```powershell
$dot = Get-ChildItem "C:\Program Files\Graphviz*\bin\dot.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$dot.FullName
```

```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  $env:Path + ";" + (Split-Path $dot.FullName),
  "User"
)
```

6. Close and reopen terminal, then verify again:

```powershell
dot -V
```

### Linux setup (Debian/Ubuntu example)

1. Install Node.js + npm:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

2. Install Graphviz (for `arch:svg` output):

```bash
sudo apt install -y graphviz
```

3. Install project dependencies:

```bash
npm install
```

4. Verify Graphviz:

```bash
dot -V
```

## 2) Build

### Build extension package assets

```bash
npm run package
```

### Architecture diagram build commands

Generate SVG (preferred):

```bash
npm run arch:svg
```

Auto mode (SVG if Graphviz exists, otherwise HTML):

```bash
npm run arch:auto
```

Generate HTML only:

```bash
npm run arch:html
```

Architecture outputs are written to:

- `docs/architecture/deps.dot`
- `docs/architecture/deps.svg`
- `docs/architecture/deps.html`

## 3) Publish

### Prepare release

1. Update `version` in `package.json`
2. Update `CHANGELOG.md`

### Publish locally (VSIX testing in VS Code)

1. Build VSIX:

```bash
npm run vsce:package
```

This creates a file like:

```bash
mekatrol-pydevice-<version>.vsix
```

2. Install the VSIX locally:

```bash
code --install-extension ./mekatrol-pydevice-<version>.vsix --force
```

3. In VS Code, run `Developer: Reload Window` and test commands/views.

### Publish to Marketplace

Sign in or refresh token at:
https://marketplace.visualstudio.com/manage

Then publish:

```bash
npm run vsce:publish
```

## Notes

- If `npm run arch:svg` says `dot` is not recognized, Graphviz is missing or not on PATH.
- On fresh installs, reopen terminal after Graphviz install so PATH updates apply.
