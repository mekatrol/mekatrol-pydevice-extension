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

const SERIAL_PORT = process.env['PYDEVICE_PORT'] ?? '/dev/ttyACM0';
const BAUD_RATE = 115200;

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
});
