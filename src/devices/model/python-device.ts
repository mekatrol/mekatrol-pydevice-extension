import { SerialPort } from 'serialport';
import { Event } from '../../core/event';
import { PyDeviceRuntimeInfo } from './py-device-runtime-info';

export interface PythonDevice {
  device: string;
  baudrate: number;
  readonly onDidReceiveData: Event<Buffer>;
  readonly onDidDisconnect: Event<void>;
  connect(serialPort: SerialPort): Promise<void>;
  disconnect(): Promise<void>;
  softReboot(timeoutMs?: number): Promise<void>;
  hardReboot(timeoutMs?: number): Promise<void>;
  sendText(text: string, options?: { drain?: boolean }): Promise<void>;
  getDeviceInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo>;
  probeDeviceInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo>;
  execute(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }>;
  open(): Promise<void>;
  close(): Promise<void>;
  probeBoardRuntimeInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo>;
  getBoardRuntimeInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo>;
  write(data: string, options?: { drain?: boolean }): Promise<void>;
  execRawCapture(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }>;
  execRawCaptureStreaming(
    command: string,
    timeoutMs?: number,
    onStdoutChunk?: (chunk: string) => void,
    onStderrChunk?: (chunk: string) => void
  ): Promise<{ stdout: string; stderr: string }>;
  execRawCaptureStreamingUntilCancelled(
    command: string,
    signal: AbortSignal,
    onStdoutChunk?: (chunk: string) => void,
    onStderrChunk?: (chunk: string) => void
  ): Promise<{ stdout: string; stderr: string }>;
}
