import { TimeoutSettingDefinition } from '../../constants/timeout-constants';
import type { PyDeviceLoggerEvent } from '../../logging/pydevice-logger-events';

const normaliseTimeoutMs = (value: number, minimumValueMs: number): number => {
  if (!Number.isFinite(value)) {
    return minimumValueMs;
  }

  return Math.max(minimumValueMs, Math.floor(value));
};

export interface PyDeviceHostServices {
  getTimeoutSettingMs: (definition: TimeoutSettingDefinition) => number;
  log: (content: string, show?: boolean) => void;
  showErrorMessage: (message: string) => void;
  emitLoggerEvent: (event: PyDeviceLoggerEvent) => void;
  isTransportLoggingEnabled: () => boolean;
}

export const defaultPyDeviceHostServices: PyDeviceHostServices = {
  getTimeoutSettingMs: (definition) => normaliseTimeoutMs(definition.defaultValueMs, definition.minimumValueMs),
  log: (content) => {
    console.log(content);
  },
  showErrorMessage: () => undefined,
  emitLoggerEvent: () => undefined,
  isTransportLoggingEnabled: () => false
};

export const resolveTimeoutMs = (
  host: Pick<PyDeviceHostServices, 'getTimeoutSettingMs'>,
  definition: TimeoutSettingDefinition,
  overrideTimeoutMs?: number
): number => {
  if (typeof overrideTimeoutMs === 'number' && Number.isFinite(overrideTimeoutMs)) {
    return normaliseTimeoutMs(overrideTimeoutMs, definition.minimumValueMs);
  }

  return host.getTimeoutSettingMs(definition);
};
