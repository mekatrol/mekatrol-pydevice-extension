import * as vscode from 'vscode';
import { pyDeviceConfigurationSection } from '../../constants/timeout-constants';
import { outputChannelLogger } from '../../logging/output-channel';
import { emitPyDeviceLoggerEvent } from '../../logging/pydevice-logger-events';
import { getTimeoutSettingMs } from '../../utils/timeout-settings';
import { showErrorMessage } from '../../utils/i18n';
import { PyDeviceHostServices } from './py-device-host-services';

const transportLogSettingKey = 'verboseReplTransportLogs';

export const createVscodePyDeviceHostServices = (): PyDeviceHostServices => {
  return {
    getTimeoutSettingMs: (definition) => getTimeoutSettingMs(definition),
    log: (content, show = true) => outputChannelLogger.log(content, show),
    showErrorMessage: (message) => {
      void showErrorMessage(message);
    },
    emitLoggerEvent: (event) => emitPyDeviceLoggerEvent(event),
    isTransportLoggingEnabled: () =>
      vscode.workspace
        .getConfiguration(pyDeviceConfigurationSection)
        .get<boolean>(transportLogSettingKey, false)
  };
};
