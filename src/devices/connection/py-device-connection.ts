/**
 * Module overview:
 * Handles low-level serial transport interactions with Python devices.
 */
import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { StringDecoder } from 'string_decoder';
import { outputChannelLogger } from '../../logging/output-channel';
import { emitPyDeviceLoggerEvent } from '../../logging/pydevice-logger-events';
import { pyDeviceInternalTimeouts, pyDeviceTimeoutSettings } from '../../constants/timeout-constants';
import { getTimeoutSettingMs, resolveTimeoutMs } from '../../utils/timeout-settings';
import { showErrorMessage } from '../../utils/i18n';
import { PyDeviceIOEvent } from './py-device-io-event';
import { PyDeviceRuntimeInfo } from '../model/py-device-runtime-info';
import {
  pyDeviceCommandSequences,
  pyDeviceControlChars,
  pyDeviceProtocolBuffers,
  pyDeviceProtocolBytes,
  pyDeviceProtocolText
} from './py-device-commands';
export class PyDeviceConnection {
  device: string;
  baudrate: number;
  user: string;
  password: string;

  inRawRepl: boolean = false;
  serialPort: SerialPort | undefined = undefined;
  nextCommand: string | undefined = undefined;

  useRawPaste: boolean = true;
  waitDelay: number = 100;
  private ioEmitter = new vscode.EventEmitter<PyDeviceIOEvent>();
  readonly onDidIO = this.ioEmitter.event;
  private readonly dataReceivedEmitter = new vscode.EventEmitter<Buffer>();
  readonly onDidReceiveData = this.dataReceivedEmitter.event;
  private readonly disconnectedEmitter = new vscode.EventEmitter<void>();
  readonly onDidDisconnect = this.disconnectedEmitter.event;
  private execQueue: Promise<void> = Promise.resolve();
  private static readonly transportLogSettingKey = 'verboseReplTransportLogs';
  private readonly reportErrorsToUser: boolean;
  private serialPortCloseHandler: (() => void) | undefined;
  private ownsSerialPort = false;

  constructor(
    device: string,
    baudrate: number = 115200,
    reportErrorsToUser: boolean = true,
    user: string = 'micro',
    password: string = 'python'
  ) {
    this.device = device;
    this.baudrate = baudrate;
    this.user = user;
    this.password = password;
    this.reportErrorsToUser = reportErrorsToUser;
  }

  async open(): Promise<void> {
    if (this.serialPort !== undefined) {
      await this.close();
    }

    this.serialPort = new SerialPort({
      path: this.device,
      baudRate: this.baudrate,
      autoOpen: false
    });

    const serialPort = this.serialPort;
    return new Promise((resolve, reject) => {
      serialPort.open((err) => {
        if (err) {
          reject(this.reportError('Failed to open serial port', err));
          return;
        }
        this.ownsSerialPort = true;
        this.attachDisconnectListener(serialPort);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.serialPort === undefined) {
      return;
    }

    const serialPort = this.serialPort;

    return new Promise((resolve, reject) => {
      serialPort.close((err) => {
        if (err) {
          reject(this.reportError('Failed to close serial port', err));
          return;
        }
        this.detachDisconnectListener(serialPort);
        this.serialPort = undefined;
        this.ownsSerialPort = false;
        resolve();
      });
    });
  }

  async connect(serialPort: SerialPort): Promise<void> {
    if (!serialPort.isOpen) {
      throw new Error('Expected an already-open serial port when connecting device transport');
    }

    if (this.serialPort && this.serialPort !== serialPort) {
      await this.close();
    }

    this.serialPort = serialPort;
    this.ownsSerialPort = false;
    this.attachDisconnectListener(serialPort);
  }

  async disconnect(): Promise<void> {
    await this.close();
  }

  async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async enterRawRepl(): Promise<boolean> {
    await this.write(pyDeviceCommandSequences.interrupt);
    await this.delay(this.waitDelay);
    await this.readAll();
    await this.write(pyDeviceCommandSequences.enterRawRepl);
    await this.delay(this.waitDelay);

    return await this.readUntil(`${pyDeviceProtocolText.rawReplPrompt}${pyDeviceProtocolText.rawReplPromptTail}`);
  }

  async rawPasteWrite(commandBytes: number[]): Promise<boolean> {
    const header = await this.readNextRaw(2);
    const windowSize = header[0];
    let windowRemain = windowSize;

    let i = 0;
    while (i < commandBytes.length) {
      while (windowRemain === 0) {
        const data = await this.serialPort!.read(1);
        if (!data || data.length === 0) {
          continue;
        }

        switch (data[0]) {
          case pyDeviceProtocolBytes.rawPasteWindowIncrement:
            windowRemain += windowSize;
            continue;
          case pyDeviceProtocolBytes.ctrlD:
            await this.write(pyDeviceControlChars.ctrlD);
            continue;
          default:
            throw this.reportError('Unexpected byte during raw paste', new Error(String(data[0])));
        }
      }

      const bytes = commandBytes.slice(i, Math.min(i + windowRemain, commandBytes.length));
      this.emitIO('tx', Buffer.from(bytes));
      this.serialPort!.write(bytes);
      windowRemain -= bytes.length;
      i += bytes.length;
    }

    await this.delay(this.waitDelay);
    await this.readAllRaw();
    await this.write(pyDeviceControlChars.ctrlD);
    await this.delay(this.waitDelay);

    const endResponse = await this.readNextRaw(1);
    if (endResponse[endResponse.length - 1] !== pyDeviceProtocolBytes.ctrlD) {
      throw this.reportError('Raw paste did not complete successfully', new Error(String(endResponse)));
    }

    const data = await this.readAllRaw();
    const str = String.fromCharCode(...data.filter((b) => b !== pyDeviceProtocolBytes.ctrlD));
    outputChannelLogger.log(str, false);

    return true;
  }

  async execRawNoFollow(command: string | number[]): Promise<boolean> {
    let commandBytes: number[] = [];

    if (typeof command === 'string') {
      commandBytes = Array.from(command).map((c) => c.charCodeAt(0));
    } else {
      commandBytes = command;
    }

    if (this.useRawPaste) {
      await this.write(pyDeviceCommandSequences.startRawPasteNegotiation);
      await this.delay(this.waitDelay);

      const response = await this.readNextRaw(2);
      if (response.length < 2 || response[0] !== pyDeviceProtocolBytes.rawPasteSupportsMarker) {
        this.useRawPaste = false;
      } else if (response[1] === 1) {
        return await this.rawPasteWrite(commandBytes);
      } else {
        this.useRawPaste = false;
      }
    }

    await this.write(pyDeviceControlChars.ctrlD);
    await this.delay(this.waitDelay);

    const response2 = await this.readAllRaw();
    outputChannelLogger.log(`Raw REPL fallback response: ${response2.join(',')}`, false);

    return true;
  }

  async exitRawRepl(): Promise<boolean> {
    await this.readAll();
    await this.write(pyDeviceCommandSequences.exitRawRepl);
    await this.delay(this.waitDelay);

    return await this.readUntil(pyDeviceProtocolText.normalReplPrompt);
  }

  async readNextRaw(length: number): Promise<number[]> {
    this.assertPortOpen();
    const bytes = await this.serialPort!.read(length);
    if (bytes && bytes.length > 0) {
      this.emitIO('rx', Buffer.from(bytes));
    }
    return bytes ?? [];
  }

  async readNext(length: number): Promise<string> {
    const bytes = await this.readNextRaw(length);
    return bytes.length === 0 ? '' : String.fromCharCode(...bytes);
  }

  async readAllRaw(minLength: number = 1): Promise<number[]> {
    this.assertPortOpen();
    let response: number[] = [];

    while (true) {
      const bytes = await this.serialPort!.read(minLength);
      if (!bytes) {
        break;
      }
      this.emitIO('rx', Buffer.from(bytes));
      response = response.concat(...bytes);
    }

    return response;
  }

  async readAll(minLength: number = 1): Promise<string> {
    const bytes = await this.readAllRaw(minLength);
    return String.fromCharCode(...bytes);
  }

  async readUntil(str: string): Promise<boolean> {
    this.assertPortOpen();
    const response = await this.readAll();
    return response.slice(-str.length) === str;
  }

  async write(data: string, options?: { drain?: boolean }): Promise<void> {
    this.assertPortOpen();
    const drain = options?.drain !== false;

    const buffer = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      buffer[i] = data.charCodeAt(i);
    }
    this.emitIO('tx', Buffer.from(buffer));

    if (!drain) {
      // Fire-and-forget for control bytes. Some USB-serial bridges never invoke
      // write callbacks for these sequences, which can deadlock command flows.
      this.serialPort!.write(buffer);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const writeAckTimeoutMs = getTimeoutSettingMs(pyDeviceTimeoutSettings.pythonSerialWriteAck);
      let settled = false;
      const settleReject = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const settleResolve = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve();
      };

      const timeout = setTimeout(() => {
        settleReject(this.reportError('Timed out waiting for serial write acknowledgement', new Error(`Timeout after ${writeAckTimeoutMs}ms`)));
      }, writeAckTimeoutMs);

      this.serialPort!.write(buffer, undefined, (err) => {
        if (err) {
          settleReject(this.reportError('Failed to write to serial port', err));
          return;
        }

        this.serialPort!.drain((drainError) => {
          if (drainError) {
            settleReject(this.reportError('Failed to flush serial write buffer', drainError));
            return;
          }

          settleResolve();
        });
      });
    });
  }

  async execRawCapture(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
    const effectiveTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonExecRawCapture, timeoutMs);
    return this.enqueueExclusive(() => this.execRawCaptureUnlocked(command, effectiveTimeoutMs));
  }

  async execRawCaptureStreaming(
    command: string,
    timeoutMs?: number,
    onStdoutChunk?: (chunk: string) => void,
    onStderrChunk?: (chunk: string) => void
  ): Promise<{ stdout: string; stderr: string }> {
    const effectiveTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonExecRawCapture, timeoutMs);
    return this.enqueueExclusive(() => this.execRawCaptureStreamingUnlocked(
      command,
      effectiveTimeoutMs,
      onStdoutChunk,
      onStderrChunk
    ));
  }

  private async execRawCaptureUnlocked(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
    return this.execRawCaptureStreamingUnlocked(command, timeoutMs);
  }

  private async execRawCaptureStreamingUnlocked(
    command: string,
    timeoutMs?: number,
    onStdoutChunk?: (chunk: string) => void,
    onStderrChunk?: (chunk: string) => void
  ): Promise<{ stdout: string; stderr: string }> {
    const effectiveTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonExecRawCapture, timeoutMs);
    this.assertPortOpen();

    await this.enterRawReplUnlocked(effectiveTimeoutMs);

    await this.write(command);
    await this.write(pyDeviceControlChars.ctrlD);

    const { stdout, stderr } = await this.waitForRawCaptureResponseStreaming(
      effectiveTimeoutMs,
      onStdoutChunk,
      onStderrChunk
    );

    await this.write(pyDeviceCommandSequences.exitRawRepl, { drain: false });
    await this.readUntilIdle(100, 600);

    return { stdout, stderr };
  }

  async getBoardRuntimeInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo> {
    const runtimeInfoTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonGetRuntimeInfo, timeoutMs);
    const softRebootTimeoutMs = getTimeoutSettingMs(pyDeviceTimeoutSettings.pythonSoftReboot);
    return this.enqueueExclusive(async () => {
      await this.softRebootRawUnlocked(Math.max(runtimeInfoTimeoutMs, softRebootTimeoutMs));
      const { stdout, stderr } = await this.execRawCaptureUnlocked(`${this.buildRuntimeInfoScript()}\n`, runtimeInfoTimeoutMs);
      const runtimeInfo = this.parseRuntimeInfo(stdout, stderr);
      runtimeInfo.uniqueId = await this.tryReadBoardUniqueIdUnlocked(runtimeInfoTimeoutMs);
      return runtimeInfo;
    });
  }

  async probeBoardRuntimeInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo> {
    const probeRuntimeTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonProbeRuntimeInfo, timeoutMs);
    return this.enqueueExclusive(async () => {
      const startedAt = Date.now();
      emitPyDeviceLoggerEvent({
        source: 'ProbeDevices',
        level: 'debug',
        action: 'probe-runtime-script-started',
        message: `Executing runtime info script on ${this.device}.`,
        details: { portPath: this.device, timeoutMs: probeRuntimeTimeoutMs }
      });
      const { stdout, stderr } = await this.execRawCaptureUnlocked(`${this.buildRuntimeInfoScript()}\n`, probeRuntimeTimeoutMs);
      const runtimeInfo = this.parseRuntimeInfo(stdout, stderr);
      emitPyDeviceLoggerEvent({
        source: 'ProbeDevices',
        level: 'debug',
        action: 'probe-runtime-script-completed',
        message: `Runtime info script completed on ${this.device}.`,
        details: { portPath: this.device, elapsedMs: Date.now() - startedAt }
      });
      emitPyDeviceLoggerEvent({
        source: 'ProbeDevices',
        level: 'debug',
        action: 'probe-uniqueid-started',
        message: `Reading device ID on ${this.device}.`,
        details: { portPath: this.device, timeoutMs: probeRuntimeTimeoutMs }
      });
      runtimeInfo.uniqueId = await this.tryReadBoardUniqueIdUnlocked(probeRuntimeTimeoutMs);
      emitPyDeviceLoggerEvent({
        source: 'ProbeDevices',
        level: 'debug',
        action: 'probe-uniqueid-completed',
        message: `Device ID read finished on ${this.device}.`,
        details: {
          portPath: this.device,
          hasDeviceId: !!runtimeInfo.uniqueId,
          elapsedMs: Date.now() - startedAt
        }
      });
      return runtimeInfo;
    });
  }

  async softReboot(timeoutMs?: number): Promise<void> {
    const softRebootTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonSoftReboot, timeoutMs);
    return this.enqueueExclusive(async () => {
      await this.softRebootRawUnlocked(Math.max(softRebootTimeoutMs, pyDeviceTimeoutSettings.pythonSoftReboot.minimumValueMs));
    });
  }

  async hardReboot(timeoutMs?: number): Promise<void> {
    const hardRebootTimeoutMs = resolveTimeoutMs(pyDeviceTimeoutSettings.pythonHardReboot, timeoutMs);
    if (!this.serialPort) {
      throw new Error('The serial port must be open to call this method');
    }

    if (this.ownsSerialPort) {
      await this.close();
      await this.delay(Math.max(pyDeviceInternalTimeouts.hardRebootOwnedPortReopenDelayMinimumMs, hardRebootTimeoutMs));
      await this.open();
      return;
    }

    const serialPort = this.serialPort;
    try {
      await new Promise<void>((resolve, reject) => {
        serialPort.set({ dtr: false, rts: false }, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      await this.delay(Math.max(pyDeviceInternalTimeouts.hardRebootSignalToggleDelayMinimumMs, hardRebootTimeoutMs));
      await new Promise<void>((resolve, reject) => {
        serialPort.set({ dtr: true, rts: true }, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    } catch {
      await this.softReboot(Math.max(hardRebootTimeoutMs, pyDeviceTimeoutSettings.pythonSoftReboot.minimumValueMs));
    }
  }

  async sendText(text: string, options?: { drain?: boolean }): Promise<void> {
    await this.write(text, options);
  }

  async getDeviceInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo> {
    return await this.getBoardRuntimeInfo(timeoutMs);
  }

  async probeDeviceInfo(timeoutMs?: number): Promise<PyDeviceRuntimeInfo> {
    return await this.probeBoardRuntimeInfo(timeoutMs);
  }

  async execute(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
    return await this.execRawCapture(command, timeoutMs);
  }

  private buildRuntimeInfoScript(): string {
    const beginMarker = pyDeviceProtocolText.runtimeInfoBeginMarker;
    const endMarker = pyDeviceProtocolText.runtimeInfoEndMarker;
    return [
      'try:',
      '  import os',
      'except:',
      '  import uos as os',
      'u = os.uname()',
      'try:',
      '  version = u.version',
      'except:',
      '  try:',
      '    version = u[3]',
      '  except:',
      "    version = ''",
      'try:',
      '  machine = u.machine',
      'except:',
      '  try:',
      '    machine = u[4]',
      '  except:',
      "    machine = ''",
      `print('${beginMarker}')`,
      'print(version)',
      'print(machine)',
      `print('${endMarker}')`
    ].join('\n');
  }

  private buildUniqueIdScript(): string {
    const beginMarker = pyDeviceProtocolText.uniqueIdBeginMarker;
    const endMarker = pyDeviceProtocolText.uniqueIdEndMarker;
    return [
      `print('${beginMarker}')`,
      'uid = ""',
      'try:',
      '  import machine',
      '  try:',
      '    import ubinascii as binascii',
      '  except:',
      '    import binascii',
      '  uid = binascii.hexlify(machine.unique_id()).decode()',
      'except:',
      '  try:',
      '    import pyb',
      '    uid = pyb.unique_id()',
      '    if not isinstance(uid, str):',
      '      try:',
      '        import ubinascii as binascii',
      '      except:',
      '        import binascii',
      '      uid = binascii.hexlify(uid).decode()',
      '  except:',
      '    uid = ""',
      'print(uid)',
      `print('${endMarker}')`
    ].join('\n');
  }

  private parseRuntimeInfo(stdout: string, stderr: string): PyDeviceRuntimeInfo {
    if (stderr.trim().length > 0) {
      throw new Error(stderr.trim());
    }

    const beginMarker = pyDeviceProtocolText.runtimeInfoBeginMarker;
    const endMarker = pyDeviceProtocolText.runtimeInfoEndMarker;
    const normalised = stdout.replace(/\r/g, '\n');
    const start = normalised.indexOf(beginMarker);
    const end = normalised.indexOf(endMarker);
    if (start < 0 || end < 0 || end <= start) {
      throw new Error(`Unexpected runtime info response: ${stdout}`);
    }

    const content = normalised
      .slice(start + beginMarker.length, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const version = content[0] ?? '';
    const machine = content[1] ?? '';
    if (!version || !machine) {
      throw new Error(`Incomplete runtime info response: ${stdout}`);
    }

    const banner = `${version}; ${machine}`;

    return {
      version,
      machine,
      banner
    };
  }

  private parseUniqueId(stdout: string, stderr: string): string {
    if (stderr.trim().length > 0) {
      throw new Error(stderr.trim());
    }

    const beginMarker = pyDeviceProtocolText.uniqueIdBeginMarker;
    const endMarker = pyDeviceProtocolText.uniqueIdEndMarker;
    const normalised = stdout.replace(/\r/g, '\n');
    const start = normalised.indexOf(beginMarker);
    const end = normalised.indexOf(endMarker);
    if (start < 0 || end < 0 || end <= start) {
      throw new Error(`Unexpected unique ID response: ${stdout}`);
    }

    const content = normalised
      .slice(start + beginMarker.length, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return content[0] ?? '';
  }

  private async tryReadBoardUniqueIdUnlocked(timeoutMs: number): Promise<string | undefined> {
    try {
      const { stdout, stderr } = await this.execRawCaptureUnlocked(`${this.buildUniqueIdScript()}\n`, timeoutMs);
      const uniqueId = this.parseUniqueId(stdout, stderr);
      return uniqueId.length > 0 ? uniqueId : undefined;
    } catch {
      return undefined;
    }
  }

  private async softRebootRawUnlocked(timeoutMs: number): Promise<void> {
    await this.enterRawReplUnlocked(timeoutMs);

    const rawPromptText = pyDeviceProtocolBuffers.rawReplPrompt;
    const softRebootText = pyDeviceProtocolBuffers.softRebootBanner;

    await this.write(pyDeviceControlChars.ctrlD);
    await this.waitForDataContains([softRebootText, rawPromptText], timeoutMs);

    await this.write(pyDeviceCommandSequences.exitRawRepl, { drain: false });
    await this.readUntilIdle(120, 800);
  }

  private async enterRawReplUnlocked(timeoutMs: number): Promise<void> {
    const rawPromptText = pyDeviceProtocolBuffers.rawReplPrompt;
    const rawPromptPrefix = pyDeviceProtocolBuffers.rawReplPromptPrefix;
    const rawPromptTail = pyDeviceProtocolBuffers.rawReplPromptTail;
    const normalReplPrompt = pyDeviceProtocolBuffers.normalReplPrompt;
    const attempts = timeoutMs < pyDeviceInternalTimeouts.enterRawReplFastThresholdMs ? 2 : 3;
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(0, timeoutMs - elapsedMs);
      if (remainingMs <= 0) {
        break;
      }
      const attemptsLeft = attempts - attempt + 1;
      const promptTimeoutMs = Math.min(
        remainingMs,
        Math.max(pyDeviceInternalTimeouts.enterRawReplPromptTimeoutMinimumMs, Math.floor(remainingMs / attemptsLeft))
      );

      try {
        await this.write(pyDeviceCommandSequences.interruptTwice, { drain: false });
        const idleData = await this.readUntilIdle(pyDeviceInternalTimeouts.enterRawReplIdleReadMs, pyDeviceInternalTimeouts.enterRawReplIdleReadMaxMs);

        // If the interrupt didn't bring the device to the normal REPL prompt (e.g. the board
        // was running code that hasn't stopped yet), send one more interrupt and wait again
        // before issuing Ctrl-A. This handles boards that need extra time to halt.
        let secondIdleData: Buffer = Buffer.alloc(0);
        if (idleData.indexOf(normalReplPrompt) < 0) {
          await this.write(pyDeviceCommandSequences.interrupt, { drain: false });
          secondIdleData = await this.readUntilIdle(pyDeviceInternalTimeouts.enterRawReplIdleReadMs, pyDeviceInternalTimeouts.enterRawReplRetryReadMaxMs);
        }

        // If the board sent no bytes at all in response to the interrupt sequence it is
        // likely hardware-unresponsive (running tight code, REPL not yet active, etc.).
        // Cap the Ctrl-A wait to a short probe window so we fail fast and let the caller
        // escalate to a hard reboot rather than burning the full per-attempt budget.
        const boardIsResponding = idleData.length > 0 || secondIdleData.length > 0;
        const effectivePromptTimeoutMs = boardIsResponding
          ? promptTimeoutMs
          : Math.min(promptTimeoutMs, pyDeviceInternalTimeouts.enterRawReplNoResponsePromptMaxMs);

        await this.write(pyDeviceCommandSequences.enterRawRepl, { drain: false });
        await this.waitForDataContains([rawPromptText, rawPromptPrefix, rawPromptTail], effectivePromptTimeoutMs);
        return;
      } catch (error) {
        lastError = error;
        await this.readUntilIdle(pyDeviceInternalTimeouts.enterRawReplIdleReadMs, pyDeviceInternalTimeouts.enterRawReplRetryReadMaxMs);
        if (attempt < attempts) {
          await this.delay(pyDeviceInternalTimeouts.enterRawReplRetryDelayMs);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : this.reportError('Failed to enter raw REPL', new Error(String(lastError)));
  }

  private async waitForDataContains(patterns: Buffer[], timeoutMs: number): Promise<number[]> {
    this.assertPortOpen();

    const bytes: number[] = [];
    return await new Promise<number[]>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        this.emitIO('rx', chunk);
        for (const value of chunk.values()) {
          bytes.push(value);
        }

        const buffer = Buffer.from(bytes);
        for (const pattern of patterns) {
          if (buffer.indexOf(pattern) >= 0) {
            cleanup();
            resolve(bytes);
            return;
          }
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(this.reportError('Serial read failed while waiting for prompt', error));
      };

      const onTimeout = () => {
        cleanup();
        reject(
          this.reportError(
            `Timed out waiting for serial response containing ${patterns.map((item) => JSON.stringify(Array.from(item.values()))).join(', ')}`,
            new Error(`Timeout after ${timeoutMs}ms`)
          )
        );
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.serialPort!.off('data', onData);
        this.serialPort!.off('error', onError);
      };

      const timer = setTimeout(onTimeout, timeoutMs);
      this.serialPort!.on('data', onData);
      this.serialPort!.on('error', onError);
    });
  }

  private async waitForRawCaptureResponseStreaming(
    timeoutMs: number,
    onStdoutChunk?: (chunk: string) => void,
    onStderrChunk?: (chunk: string) => void
  ): Promise<{ stdout: string; stderr: string }> {
    this.assertPortOpen();

    const stdoutBytes: number[] = [];
    const stderrBytes: number[] = [];
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    type CapturePhase = 'stdout' | 'stderr';
    let phase: CapturePhase = 'stdout';

    const okPrefix = pyDeviceProtocolText.rawCommandAcceptedPrefix;
    let okPrefixMatched = 0;
    let okPrefixResolved = false;

    const emitStdout = (bytes: number[]): void => {
      if (bytes.length === 0) {
        return;
      }
      stdoutBytes.push(...bytes);
      if (onStdoutChunk) {
        const text = stdoutDecoder.write(Buffer.from(bytes));
        if (text.length > 0) {
          onStdoutChunk(text);
        }
      }
    };

    const emitStderr = (bytes: number[]): void => {
      if (bytes.length === 0) {
        return;
      }
      stderrBytes.push(...bytes);
      if (onStderrChunk) {
        const text = stderrDecoder.write(Buffer.from(bytes));
        if (text.length > 0) {
          onStderrChunk(text);
        }
      }
    };

    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const finish = () => {
        const stdoutRemainder = onStdoutChunk ? stdoutDecoder.end() : '';
        if (stdoutRemainder.length > 0 && onStdoutChunk) {
          onStdoutChunk(stdoutRemainder);
        }
        const stderrRemainder = onStderrChunk ? stderrDecoder.end() : '';
        if (stderrRemainder.length > 0 && onStderrChunk) {
          onStderrChunk(stderrRemainder);
        }
        resolve({
          stdout: Buffer.from(stdoutBytes).toString('utf8'),
          stderr: Buffer.from(stderrBytes).toString('utf8')
        });
      };

      const onData = (chunk: Buffer) => {
        this.emitIO('rx', chunk);
        const stdoutChunkBytes: number[] = [];
        const stderrChunkBytes: number[] = [];

        for (const value of chunk.values()) {
          if (!okPrefixResolved) {
            if (okPrefixMatched < okPrefix.length && value === okPrefix.charCodeAt(okPrefixMatched)) {
              okPrefixMatched += 1;
              if (okPrefixMatched === okPrefix.length) {
                okPrefixResolved = true;
              }
              continue;
            }

            okPrefixResolved = true;
            if (okPrefixMatched > 0) {
              for (let i = 0; i < okPrefixMatched; i += 1) {
                stdoutChunkBytes.push(okPrefix.charCodeAt(i));
              }
              okPrefixMatched = 0;
            }
          }

          if (phase === 'stdout') {
            if (value === pyDeviceProtocolBytes.ctrlD) {
              phase = 'stderr';
              continue;
            }
            stdoutChunkBytes.push(value);
            continue;
          }

          if (value === pyDeviceProtocolBytes.ctrlD) {
            emitStdout(stdoutChunkBytes);
            emitStderr(stderrChunkBytes);
            cleanup();
            finish();
            return;
          }
          stderrChunkBytes.push(value);
        }

        emitStdout(stdoutChunkBytes);
        emitStderr(stderrChunkBytes);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(this.reportError('Serial read failed while waiting for command response', error));
      };

      const onTimeout = () => {
        cleanup();
        reject(this.reportError('Timed out waiting for raw capture command completion', new Error(`Timeout after ${timeoutMs}ms`)));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.serialPort!.off('data', onData);
        this.serialPort!.off('error', onError);
      };

      const timer = setTimeout(onTimeout, timeoutMs);
      this.serialPort!.on('data', onData);
      this.serialPort!.on('error', onError);
    });
  }

  private async readUntilIdle(idleMs: number, maxMs: number): Promise<Buffer> {
    this.assertPortOpen();
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve) => {
      let idleTimer: NodeJS.Timeout | undefined;
      let maxTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }

        if (maxTimer) {
          clearTimeout(maxTimer);
        }

        this.serialPort!.off('data', onData);
        this.serialPort!.off('error', onError);
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      const onData = (chunk: Buffer) => {
        this.emitIO('rx', chunk);
        chunks.push(chunk);
        if (idleTimer) {
          clearTimeout(idleTimer);
        }

        idleTimer = setTimeout(finish, idleMs);
      };

      const onError = () => {
        finish();
      };

      idleTimer = setTimeout(finish, idleMs);
      maxTimer = setTimeout(finish, maxMs);

      this.serialPort!.on('data', onData);
      this.serialPort!.on('error', onError);
    });

    return Buffer.concat(chunks);
  }

  assertPortOpen() {
    if (!this.serialPort) {
      throw new Error('The serial port must be open to call this method');
    }
  }

  private reportError(context: string, error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `${context}: ${detail}`;
    if (this.reportErrorsToUser && this.shouldSurfaceErrorToUser(message)) {
      showErrorMessage(message);
    }
    outputChannelLogger.log(message, true);
    return new Error(message);
  }

  private shouldSurfaceErrorToUser(message: string): boolean {
    // These transport timeouts are expected during probing/retries and should
    // be surfaced in row status instead of repeated global pop-up errors.
    if (message.includes('Timed out waiting for serial response containing')) {
      return false;
    }
    return true;
  }

  private emitIO(direction: 'tx' | 'rx', data: Buffer): void {
    if (data.length === 0) {
      return;
    }

    this.ioEmitter.fire({ direction, data });
    if (direction === 'rx') {
      this.dataReceivedEmitter.fire(data);
    }
    console.debug(`[REPL ${direction.toUpperCase()}] ${this.formatBytesForLog(data)}`);
    if (this.isTransportLoggingEnabled()) {
      outputChannelLogger.log(`[REPL ${direction.toUpperCase()}] ${this.formatBytesForLog(data)}`, false);
    }
  }

  private isTransportLoggingEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('mekatrol.pydevice')
      .get<boolean>(PyDeviceConnection.transportLogSettingKey, false);
  }

  private formatBytesForLog(data: Buffer): string {
    let output = '';
    for (const value of data.values()) {
      if (value === 10) {
        output += '\\n';
        continue;
      }

      if (value === 13) {
        output += '\\r';
        continue;
      }

      if (value >= 32 && value <= 126) {
        output += String.fromCharCode(value);
        continue;
      }

      output += `\\x${value.toString(16).padStart(2, '0')}`;
    }

    return output;
  }

  private async enqueueExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.execQueue.then(fn, fn);
    this.execQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private attachDisconnectListener(serialPort: SerialPort): void {
    this.detachDisconnectListener(serialPort);
    this.serialPortCloseHandler = () => {
      this.disconnectedEmitter.fire();
    };
    serialPort.on('close', this.serialPortCloseHandler);
  }

  private detachDisconnectListener(serialPort: SerialPort): void {
    if (!this.serialPortCloseHandler) {
      return;
    }
    serialPort.off('close', this.serialPortCloseHandler);
    this.serialPortCloseHandler = undefined;
  }
}
