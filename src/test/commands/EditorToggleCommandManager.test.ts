import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorToggleCommandManager } from '../../commands/EditorToggleCommandManager';
import { QuickAccessProvider } from '../../views/QuickAccessProvider';
import { JsonPrettyService } from '../../services/JsonPrettyService';
import { MockExtensionContext } from '../utils/Mocks';

suite('EditorToggleCommandManager Test Suite', () => {
    let mockContext: MockExtensionContext;
    let mockQuickAccessProvider: QuickAccessProvider;
    let mockJsonPrettyService: JsonPrettyService;
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

        mockQuickAccessProvider = {
            refresh: () => { },
            toggleFileSizeUnit: () => { }
        } as unknown as QuickAccessProvider;

        mockJsonPrettyService = {
            execute: async () => { }
        } as unknown as JsonPrettyService;

        new EditorToggleCommandManager(mockContext as unknown as vscode.ExtensionContext, mockQuickAccessProvider, mockJsonPrettyService);
        vscode.commands.registerCommand = originalRegisterCommand;
    });

    teardown(() => {
        vscode.commands.registerCommand = originalRegisterCommand;
    });

    test('ToggleWordWrap executes editor command', async () => {
        let executedCommand = '';
        const originalExecuteCommand = vscode.commands.executeCommand;

        vscode.commands.executeCommand = (async <T>(cmd: string) => {
            executedCommand = cmd;
            return undefined as T;
        }) as unknown as typeof vscode.commands.executeCommand;

        const toggleCmd = registeredCommands.get('logmagnifier.toggleWordWrap');
        assert.ok(toggleCmd);
        await toggleCmd();

        vscode.commands.executeCommand = originalExecuteCommand;
        assert.strictEqual(executedCommand, 'editor.action.toggleWordWrap');
    });

    test('ApplyJsonPretty calls JsonPrettyService', async () => {
        let executed = false;
        mockJsonPrettyService.execute = async () => { executed = true; };

        const applyCmd = registeredCommands.get('logmagnifier.applyJsonPretty');
        assert.ok(applyCmd);
        await applyCmd();

        assert.strictEqual(executed, true);
    });
});
