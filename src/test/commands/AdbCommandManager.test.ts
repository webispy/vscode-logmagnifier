import * as assert from 'assert';
import * as vscode from 'vscode';
import { AdbCommandManager } from '../../commands/AdbCommandManager';
import { AdbService } from '../../services/AdbService';
import { AdbDeviceTreeProvider } from '../../views/AdbDeviceTreeProvider';
import { MockExtensionContext } from '../utils/Mocks';
import { AdbDevice, LogcatSession } from '../../models/AdbModels';

suite('AdbCommandManager Test Suite', () => {
    let mockContext: MockExtensionContext;
    let mockService: AdbService;
    let mockTreeProvider: AdbDeviceTreeProvider;
    let registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    let originalRegisterCommand: typeof vscode.commands.registerCommand;

    setup(() => {
        mockContext = new MockExtensionContext();
        registeredCommands = new Map();

        originalRegisterCommand = vscode.commands.registerCommand;
        vscode.commands.registerCommand = (command: string, callback: (...args: unknown[]) => unknown) => {
            registeredCommands.set(command, callback);
            return { dispose: () => { } };
        };

        mockService = {
            getSessions: () => [],
            createSession: () => { },
            startSession: async () => { },
            stopSession: () => { },
            removeSession: () => { }
        } as unknown as AdbService;

        mockTreeProvider = {
            refreshDevices: async () => { }
        } as unknown as AdbDeviceTreeProvider;

        new AdbCommandManager(
            mockContext as unknown as vscode.ExtensionContext,
            mockService,
            mockTreeProvider,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { onDidChangeSelection: () => ({ dispose: () => { } }) } as unknown as vscode.TreeView<any>
        );

        vscode.commands.registerCommand = originalRegisterCommand;
    });

    teardown(() => {
        vscode.commands.registerCommand = originalRegisterCommand;
    });

    test('AddLogcatSession creates new session via input box', async () => {
        const device: AdbDevice = { id: 'dev1', type: 'device' };

        let createdSessionName = '';
        mockService.createSession = (name: string, _dev: AdbDevice) => {
            createdSessionName = name;
            return {} as LogcatSession;
        };

        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => 'My Custom Session';

        const addCmd = registeredCommands.get('logmagnifier.addLogcatSession');
        assert.ok(addCmd, 'Command should be registered');

        await addCmd(device);

        vscode.window.showInputBox = originalShowInputBox;

        assert.strictEqual(createdSessionName, 'My Custom Session');
    });

    test('StartLogcatSession delegates to AdbService', async () => {
        const session: LogcatSession = { id: 'ses-1', name: 'Ses1', device: { id: 'dev1', type: 'device' }, tags: [], isRunning: false, useStartFromCurrentTime: true };

        let startedId = '';
        mockService.startSession = async (id: string) => {
            startedId = id;
        };

        const startCmd = registeredCommands.get('logmagnifier.startLogcatSession');
        assert.ok(startCmd);

        await startCmd(session);

        assert.strictEqual(startedId, 'ses-1');
    });

    test('StopLogcatSession delegates to AdbService', async () => {
        const session: LogcatSession = { id: 'ses-1', name: 'Ses1', device: { id: 'dev1', type: 'device' }, tags: [], isRunning: true, useStartFromCurrentTime: true };

        let stoppedId = '';
        mockService.stopSession = (id: string) => {
            stoppedId = id;
        };

        const stopCmd = registeredCommands.get('logmagnifier.stopLogcatSession');
        assert.ok(stopCmd);

        await stopCmd(session);

        assert.strictEqual(stoppedId, 'ses-1');
    });
});
