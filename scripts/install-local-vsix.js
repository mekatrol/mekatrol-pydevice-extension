const { spawnSync } = require('child_process');
const path = require('path');

const packageJson = require('../package.json');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vsixPath = path.resolve(__dirname, `../mekatrol-pydevice-${packageJson.version}.vsix`);

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run(npmCmd, ['run', 'vsce:package']);
run('code', ['--install-extension', vsixPath]);
