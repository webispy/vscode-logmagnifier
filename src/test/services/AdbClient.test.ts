import * as assert from 'assert';
import * as cpTypes from 'child_process';
import * as vscode from 'vscode';
import { AdbClient } from '../../services/adb/AdbClient';
import { Logger } from '../../services/Logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('child_process') as typeof cpTypes;

suite('AdbClient Test Suite', () => {
    let adbClient: AdbClient;
    let logger: Logger;
    let originalExecFile: PropertyDescriptor | undefined;
    let originalSpawn: PropertyDescriptor | undefined;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

    setup(() => {
        logger = {
            info: () => { },
            warn: () => { },
            error: () => { },
            dispose: () => { }
        } as unknown as Logger;
        adbClient = new AdbClient(logger);
        originalExecFile = Object.getOwnPropertyDescriptor(cp, 'execFile');
        originalSpawn = Object.getOwnPropertyDescriptor(cp, 'spawn');
        originalGetConfiguration = vscode.workspace.getConfiguration;
    });

    teardown(() => {
        logger.dispose();
        if (originalExecFile) {
            Object.defineProperty(cp, 'execFile', originalExecFile);
        }
        if (originalSpawn) {
            Object.defineProperty(cp, 'spawn', originalSpawn);
        }
        vscode.workspace.getConfiguration = originalGetConfiguration;
    });

    test('getAdbPath returns configured path', () => {
        // @ts-expect-error Mocking for test
        vscode.workspace.getConfiguration = () => {
            return {
                get: (key: string) => {
                    if (key === 'adbPath') { return '/custom/adb/path'; }
                    return undefined;
                }
            };
        };
        assert.strictEqual(adbClient.getAdbPath(), '/custom/adb/path');
    });

    test('getAdbPath returns default path if not configured', () => {
        // @ts-expect-error Mocking for test
        vscode.workspace.getConfiguration = () => {
            return {
                get: (_key: string) => undefined
            };
        };
        assert.strictEqual(adbClient.getAdbPath(), 'adb');
    });

    test('execAdb resolves with stdout on success', async () => {
        // @ts-expect-error Mocking for test
        vscode.workspace.getConfiguration = () => ({ get: () => 'adb' });

        Object.defineProperty(cp, 'execFile', {
            value: (_file: string, args: readonly string[], _options: cpTypes.ExecFileOptions, callback: (error: cpTypes.ExecException | null, stdout: string, stderr: string) => void) => {
                assert.deepStrictEqual(args, ['devices']);
                callback(null, 'device1\tdevice\n', '');
                return {} as cpTypes.ChildProcess;
            },
            configurable: true
        });

        const result = await adbClient.execAdb(['devices'], {});
        assert.strictEqual(result, 'device1\tdevice\n');
    });

    test('execAdb rejects with error on failure', async () => {
        // @ts-expect-error Mocking for test
        vscode.workspace.getConfiguration = () => ({ get: () => 'adb' });

        Object.defineProperty(cp, 'execFile', {
            value: (_file: string, _args: readonly string[], _options: cpTypes.ExecFileOptions, callback: (error: cpTypes.ExecException | null, stdout: string, stderr: string) => void) => {
                callback(new Error('Command failed'), '', 'stderr output');
                return {} as cpTypes.ChildProcess;
            },
            configurable: true
        });

        try {
            await adbClient.execAdb(['devices'], {});
            assert.fail('Should have thrown an error');
        } catch (e: unknown) {
            if (e instanceof Error) {
                assert.strictEqual(e.message, 'Command failed (stderr: stderr output)');
            } else {
                assert.fail('Unexpected error type');
            }
        }
    });

    test('spawnAdb returns child process', () => {
        // @ts-expect-error Mocking for test
        vscode.workspace.getConfiguration = () => ({ get: () => 'adb' });

        const mockChildProcess = { pid: 12345 } as cpTypes.ChildProcess;
        Object.defineProperty(cp, 'spawn', {
            value: (command: string, args: readonly string[], _options: cpTypes.SpawnOptions) => {
                assert.strictEqual(command, 'adb');
                assert.deepStrictEqual(args, ['logcat']);
                return mockChildProcess;
            },
            configurable: true
        });

        const result = adbClient.spawnAdb(['logcat']);
        assert.strictEqual(result.pid, 12345);
    });
});
