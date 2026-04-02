/// <reference types="mocha" />
/**
 * Integration test: PyDeviceConnection serial open + raw REPL entry.
 *
 * Requires a MicroPython board connected on PYDEVICE_PORT (default /dev/ttyACM0).
 * Run as a plain Node integration test via `npm run test:integration`
 * (no VS Code launch required).
 *
 * Environment variable:
 *   PYDEVICE_PORT  – serial port path (default: /dev/ttyACM0)
 */
import * as assert from 'assert';
import { PyDeviceConnection } from '../../devices/connection/py-device-connection';
import { pyDeviceControlChars } from '../../devices/connection/py-device-commands';

const SERIAL_PORT = process.env['PYDEVICE_PORT'] ?? '/dev/ttyACM0';
const BAUD_RATE = 115200;

const errorToMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const tryEnterRawRepl = async (
  device: PyDeviceConnection,
  label: string,
  steps: string[]
): Promise<boolean> => {
  try {
    const entered = await device.enterRawRepl();
    steps.push(`${label}: ${entered ? 'entered' : 'prompt-not-matched'}`);
    return entered;
  } catch (error) {
    steps.push(`${label}: error (${errorToMessage(error)})`);
    return false;
  }
};

const enterRawReplWithAggressiveRecovery = async (
  device: PyDeviceConnection
): Promise<{ entered: boolean; steps: string[] }> => {
  const steps: string[] = [];

  // Baseline attempt using the normal transport method.
  if (await tryEnterRawRepl(device, 'baseline-enterRawRepl', steps)) {
    return { entered: true, steps };
  }

  // User-requested recovery sequence; repeat a few times before escalating.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await device.write(`\r${pyDeviceControlChars.ctrlA}${pyDeviceControlChars.ctrlC}`, { drain: false });
    await device.delay(150);
    await device.readAll();

    if (await tryEnterRawRepl(device, `ctrl-a-ctrl-c-${attempt}`, steps)) {
      return { entered: true, steps };
    }
  }

  // pyboard.py-style recovery starts with interrupting running code.
  await device.write(`\r${pyDeviceControlChars.ctrlC}${pyDeviceControlChars.ctrlC}`, { drain: false });
  await device.delay(150);
  await device.readAll();
  if (await tryEnterRawRepl(device, 'ctrl-c-twice', steps)) {
    return { entered: true, steps };
  }

  // Force friendly REPL, then try entering raw mode again.
  await device.write(`\r${pyDeviceControlChars.ctrlB}`, { drain: false });
  await device.delay(150);
  await device.readAll();
  if (await tryEnterRawRepl(device, 'ctrl-b-then-enter', steps)) {
    return { entered: true, steps };
  }

  // Soft reset can recover from a wedged interpreter while preserving USB serial.
  try {
    await device.softReboot(9000);
    steps.push('soft-reboot: completed');
  } catch (error) {
    steps.push(`soft-reboot: error (${errorToMessage(error)})`);
  }
  if (await tryEnterRawRepl(device, 'after-soft-reboot', steps)) {
    return { entered: true, steps };
  }

  // Last resort: hard reboot path (DTR/RTS toggle or owned-port reopen).
  try {
    await device.hardReboot(400);
    await device.delay(1200);
    steps.push('hard-reboot: completed');
  } catch (error) {
    steps.push(`hard-reboot: error (${errorToMessage(error)})`);
  }
  if (await tryEnterRawRepl(device, 'after-hard-reboot', steps)) {
    return { entered: true, steps };
  }

  return { entered: false, steps };
};

suite('Integration: PyDeviceConnection REPL', function () {
  // Hardware I/O needs more time than the default 2 s Mocha budget.
  this.timeout(15000);

  test(`opens ${SERIAL_PORT}, enters raw REPL mode, then closes`, async () => {
    // Step 1 – create the low-level connection object (port not open yet).
    const device = new PyDeviceConnection(
      SERIAL_PORT,
      BAUD_RATE,
      /* reportErrorsToUser */ false
    );

    let replEntered = false;

    try {
      // Step 2 – open the serial port.
      await device.open();

      // Step 3 – send interrupt and Ctrl-A to request raw REPL mode,
      // then verify the device acknowledged with the raw-REPL prompt.
      const entered = await device.enterRawRepl();

      replEntered = entered;

      // Step 4 – assert that raw REPL mode was confirmed.
      assert.strictEqual(entered, true, `Device on ${SERIAL_PORT} did not acknowledge raw REPL entry`);
    } finally {
      // Step 5 – cleanup: attempt a clean REPL exit then close the port.
      if (replEntered) {
        try {
          await device.exitRawRepl();
        } catch {
          // Best-effort – ignore if exit fails; close will reset the connection.
        }
      }

      await device.close();
    }
  });

  test(`opens ${SERIAL_PORT}, sends Ctrl-A/Ctrl-C recovery sequence, then enters raw REPL`, async () => {
    this.timeout(45000);

    const device = new PyDeviceConnection(
      SERIAL_PORT,
      BAUD_RATE,
      /* reportErrorsToUser */ false
    );

    let replEntered = false;

    try {
      await device.open();

      const recovery = await enterRawReplWithAggressiveRecovery(device);
      replEntered = recovery.entered;

      assert.strictEqual(
        recovery.entered,
        true,
        `Device on ${SERIAL_PORT} did not enter raw REPL after aggressive recovery. Steps: ${recovery.steps.join(' | ')}`
      );
    } finally {
      if (replEntered) {
        try {
          await device.exitRawRepl();
        } catch {
          // Best-effort – ignore if exit fails; close will reset the connection.
        }
      }

      await device.close();
    }
  });
});
