const vscode = acquireVsCodeApi();
const initialStateElement = document.getElementById('initial-state');
let initialState = {};
try {
  initialState = initialStateElement ? JSON.parse(initialStateElement.textContent || '{}') : {};
} catch {
  initialState = {};
}

const data = initialState.data && typeof initialState.data === 'object' ? initialState.data : {};
const i18n = initialState.i18n && typeof initialState.i18n === 'object' ? initialState.i18n : {};
const msg = (key, fallback) => (typeof i18n[key] === 'string' ? i18n[key] : fallback);
let connectBusy = false;
let connectDisabled = !!data.connectDisabled;
let connectDisabledReason = typeof data.connectDisabledReason === 'string' ? data.connectDisabledReason : '';
let syncDisabled = !!data.syncDisabled;
let syncDisabledReason = typeof data.syncDisabledReason === 'string' ? data.syncDisabledReason : '';

const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
};

setText('displayName', data.displayName || '');
setText('deviceId', data.deviceId || '');
setText('setDeviceName', msg('setDeviceName', 'Set device name'));
setText('sync', msg('sync', 'Sync files'));
setText('connect', msg('connect', 'Connect'));
setText('connectBusyText', msg('connecting', 'Connecting...'));
setText('disconnect', msg('disconnect', 'Disconnect'));
setText('refresh', msg('refresh', 'Refresh'));
setText('close', msg('close', 'Close'));
setText('connectionTitle', msg('connection', 'Connection'));
setText('mappingsTitle', msg('mappings', 'Device Folder Mapping'));
setText('runtimeTitle', msg('runtimeInfo', 'Device info'));
setText('librariesTitle', msg('libraryMappings', 'Device Library mappings'));
setText('statusLabel', msg('status', 'Status'));
setText('serialPortLabel', msg('serialPort', 'Serial port'));
setText('baudRateLabel', msg('baudRate', 'Baud rate'));
setText('folderLabel', msg('folder', 'Folder'));
setText('folderStatusLabel', msg('folderStatus', 'Status'));
setText('librariesLabel', msg('libraries', 'Libraries'));
setText('versionLabel', msg('version', 'Version'));
setText('machineLabel', msg('machine', 'Machine'));
setText('uniqueIdLabel', msg('uniqueId', 'Device ID'));
setText('bannerLabel', msg('banner', 'Banner'));
setText('computerFolderLabel', msg('computerFolder', 'Computer folder'));
setText('deviceFolderLabel', msg('deviceFolder', 'Device folder'));
setText('libraryStatusLabel', msg('libraryStatus', 'Status'));
setText('serialPortValue', data.serialPort || '');
setText('baudRateValue', data.baudRate || '');
setText('mappedFolderValue', data.mappedFolder || '');
setText('mappedFolderStatus', data.mappedFolderStatus || msg('notMapped', 'Not mapped'));
setText('versionValue', data.runtimeInfo?.version || '');
setText('machineValue', data.runtimeInfo?.machine || '');
setText('uniqueIdValue', data.runtimeInfo?.uniqueId || '');
setText('bannerValue', data.runtimeInfo?.banner || '');

const connectionStatusElement = document.getElementById('connectionStatus');
if (connectionStatusElement) {
  connectionStatusElement.textContent = data.connectionStatus || '';
  if (data.connected) {
    connectionStatusElement.classList.add('ok');
  } else {
    connectionStatusElement.classList.add('warn');
  }
}

const connectButton = document.getElementById('connect');
const syncButton = document.getElementById('sync');
const connectBusyOverlay = document.getElementById('connectBusyOverlay');
const updateActionState = () => {
  if (connectButton) {
    connectButton.disabled = connectDisabled || connectBusy;
    connectButton.title = connectDisabledReason || '';
  }
  if (syncButton) {
    syncButton.disabled = syncDisabled;
    syncButton.title = syncDisabledReason || '';
  }
  if (connectBusyOverlay) {
    connectBusyOverlay.classList.toggle('hidden', !connectBusy);
  }
};

if (connectButton) {
  connectButton.style.display = data.connected ? 'none' : 'inline-block';
}

const disconnectButton = document.getElementById('disconnect');
if (disconnectButton) {
  disconnectButton.style.display = data.connected ? 'inline-block' : 'none';
}

const mappedFolderStatusElement = document.getElementById('mappedFolderStatus');
if (mappedFolderStatusElement) {
  if (data.mappedFolderMissing) {
    mappedFolderStatusElement.classList.add('warn');
  } else {
    mappedFolderStatusElement.classList.add('ok');
  }
}

const rowsBody = document.getElementById('libraryRows');
const libraries = Array.isArray(data.libraries) ? data.libraries : [];
if (rowsBody) {
  if (libraries.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'empty';
    td.textContent = msg('noLibraries', 'No library folders mapped.');
    tr.appendChild(td);
    rowsBody.appendChild(tr);
  } else {
    for (const library of libraries) {
      const tr = document.createElement('tr');

      const hostTd = document.createElement('td');
      const hostCode = document.createElement('code');
      hostCode.textContent = library.hostRelativePath || '';
      hostTd.appendChild(hostCode);
      tr.appendChild(hostTd);

      const deviceTd = document.createElement('td');
      const deviceCode = document.createElement('code');
      deviceCode.textContent = `/${library.devicePath || ''}`;
      deviceTd.appendChild(deviceCode);
      tr.appendChild(deviceTd);

      const statusTd = document.createElement('td');
      const statusPill = document.createElement('span');
      statusPill.className = library.missing ? 'pill warn' : 'pill ok';
      statusPill.textContent = library.missing
        ? msg('missingOnComputer', 'Missing on computer')
        : msg('exists', 'Exists');
      statusTd.appendChild(statusPill);
      tr.appendChild(statusTd);

      rowsBody.appendChild(tr);
    }
  }
}

document.getElementById('connect')?.addEventListener('click', () => {
  if (connectDisabled || connectBusy) {
    return;
  }
  connectDisabled = true;
  updateActionState();
  vscode.postMessage({ type: 'connect' });
});

document.getElementById('sync')?.addEventListener('click', () => {
  if (syncDisabled) {
    return;
  }
  vscode.postMessage({ type: 'sync' });
});

document.getElementById('disconnect')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'disconnect' });
});

document.getElementById('setDeviceName')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'set_device_name' });
});

document.getElementById('refresh')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});

document.getElementById('close')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'close' });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'connectState') {
    if (typeof message.disabled === 'boolean') {
      connectDisabled = message.disabled;
    }
    if (typeof message.reason === 'string') {
      connectDisabledReason = message.reason;
    } else if (message.reason === null || message.reason === undefined) {
      connectDisabledReason = '';
    }
    if (typeof message.busy === 'boolean') {
      connectBusy = message.busy;
    }
    updateActionState();
    return;
  }
  if (message.type === 'connectBusy' && typeof message.busy === 'boolean') {
    connectBusy = message.busy;
    updateActionState();
  }
});

updateActionState();
