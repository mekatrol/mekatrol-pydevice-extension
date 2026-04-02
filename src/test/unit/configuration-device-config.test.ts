/**
 * Unit tests for configuration-domain utility behavior.
 *
 * The suite validates normalization, mutation behavior, parsing of unknown
 * input, and helper projections used by other modules.
 */
import * as assert from 'assert';
import {
  DeviceConfiguration,
  getDeviceHostFolderMappings,
  getDeviceLibraryFolderMappings,
  getDeviceNames,
  getDeviceSyncExcludedPaths,
  PyDeviceConfiguration
} from '../../utils/configuration';

suite('configuration DeviceConfiguration', () => {
  test('normalises values and removes invalid paths', () => {
    // Arrange: build config with noisy spacing, slash variance, duplicates,
    // and empty values.
    const config = new DeviceConfiguration({
      hostFolder: '  host ',
      libraryFolders: [' lib\\a ', '/lib/b/', '', 'lib/a'],
      name: '  board ',
      syncExcludedPaths: [' /a ', 'b/', 'a']
    });

    // Assert: host folder is trimmed.
    assert.strictEqual(config.getHostFolder(), 'host');

    // Assert: library folders are normalized, deduplicated, sorted.
    assert.deepStrictEqual(config.getLibraryFolders(), ['lib/a', 'lib/b']);

    // Assert: device name is trimmed.
    assert.strictEqual(config.getName(), 'board');

    // Assert: exclusion paths normalized and deduplicated.
    assert.deepStrictEqual(config.getSyncExcludedPaths(), ['a', 'b']);
  });

  test('drops any path values that reference the .pydevice folder', () => {
    const config = new DeviceConfiguration({
      hostFolder: ' .pydevice/device-cache ',
      libraryFolders: ['lib', 'pkg/.pydevice/cache', '../.pydevice/tmp', 'src'],
      syncExcludedPaths: ['build', '.pydevice/logs', 'out/.pydevice']
    });

    assert.strictEqual(config.getHostFolder(), undefined);
    assert.deepStrictEqual(config.getLibraryFolders(), ['lib', 'src']);
    assert.deepStrictEqual(config.getSyncExcludedPaths(), ['build']);
  });

  test('drops absolute paths that reference the .pydevice folder', () => {
    const config = new DeviceConfiguration({
      hostFolder: '/workspace/.pydevice/device-cache',
      libraryFolders: ['/opt/libs', 'C:\\repo\\.pydevice\\cache', '/tmp/.pydevice/staging'],
      syncExcludedPaths: ['C:\\work\\.pydevice\\logs', '/var/tmp/.pydevice']
    });

    assert.strictEqual(config.getHostFolder(), undefined);
    assert.deepStrictEqual(config.getLibraryFolders(), ['opt/libs']);
    assert.deepStrictEqual(config.getSyncExcludedPaths(), []);
  });

  test('supports adding and removing sync exclusions', () => {
    // Arrange: start from empty configuration.
    const config = new DeviceConfiguration();

    // Act: add one value with slash noise, then duplicate, then second value.
    config.addSyncExcludedPath('/foo/');
    config.addSyncExcludedPath('foo');
    config.addSyncExcludedPath('bar');

    // Assert: duplicate is ignored, values are normalized and sorted.
    assert.deepStrictEqual(config.getSyncExcludedPaths(), ['bar', 'foo']);

    // Act: remove one value using slash-noisy representation.
    config.removeSyncExcludedPath('/bar/');

    // Assert: removed value is gone and unrelated value remains.
    assert.deepStrictEqual(config.getSyncExcludedPaths(), ['foo']);
  });

  test('fromUnknown ignores invalid payloads', () => {
    // Act: parse non-object input.
    const emptyFromScalar = DeviceConfiguration.fromUnknown(42);

    // Assert: invalid input becomes empty config JSON.
    assert.deepStrictEqual(emptyFromScalar.toJSON(), {});

    // Arrange: mixed-validity object with invalid hostFolder and non-string
    // entries in arrays.
    const fromObject = DeviceConfiguration.fromUnknown({
      hostFolder: 12,
      libraryFolders: ['a', 2],
      name: 'device',
      syncExcludedPaths: ['x', null]
    });

    // Assert: only valid values survive parsing.
    assert.deepStrictEqual(fromObject.toJSON(), {
      libraryFolders: ['a'],
      name: 'device',
      syncExcludedPaths: ['x']
    });
  });

  test('setters silently clear .pydevice path values', () => {
    const config = new DeviceConfiguration({
      hostFolder: 'src',
      libraryFolders: ['lib'],
      syncExcludedPaths: ['tmp']
    });

    config.setHostFolder('nested/.pydevice/state');
    config.setLibraryFolders(['ok', '.pydevice/cache']);
    config.setSyncExcludedPaths(['allowed', 'tmp/.pydevice']);

    assert.strictEqual(config.getHostFolder(), undefined);
    assert.deepStrictEqual(config.getLibraryFolders(), ['ok']);
    assert.deepStrictEqual(config.getSyncExcludedPaths(), ['allowed']);
  });

  test('setters silently clear absolute .pydevice path values', () => {
    const config = new DeviceConfiguration({
      hostFolder: 'src',
      libraryFolders: ['lib'],
      syncExcludedPaths: ['tmp']
    });

    config.setHostFolder('C:\\repo\\.pydevice\\state');
    config.setLibraryFolders(['/safe/path', '/workspace/.pydevice/cache']);
    config.setSyncExcludedPaths(['/allowed', 'C:\\repo\\.pydevice\\tmp']);

    assert.strictEqual(config.getHostFolder(), undefined);
    assert.deepStrictEqual(config.getLibraryFolders(), ['safe/path']);
    assert.deepStrictEqual(config.getSyncExcludedPaths(), ['allowed']);
  });

  test('mapping helpers include only populated values', () => {
    // Arrange: one fully populated device config and one empty config.
    const full = new DeviceConfiguration({
      hostFolder: 'host-folder',
      libraryFolders: ['libs/common'],
      name: 'devname',
      syncExcludedPaths: ['tmp']
    });
    const empty = new DeviceConfiguration();

    // Arrange: compose full configuration payload.
    const config: PyDeviceConfiguration = {
      devices: {
        a: full,
        b: empty
      }
    };

    // Assert: each projection helper returns only populated device `a`.
    assert.deepStrictEqual(getDeviceHostFolderMappings(config), { a: 'host-folder' });
    assert.deepStrictEqual(getDeviceLibraryFolderMappings(config), { a: ['libs/common'] });
    assert.deepStrictEqual(getDeviceNames(config), { a: 'devname' });
    assert.deepStrictEqual(getDeviceSyncExcludedPaths(config), { a: ['tmp'] });
  });
});

