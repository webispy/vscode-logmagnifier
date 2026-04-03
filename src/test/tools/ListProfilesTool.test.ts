import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { ListProfilesTool } from '../../tools/ListProfilesTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('ListProfilesTool', () => {
    let filterManager: FilterManager;
    let tool: ListProfilesTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new ListProfilesTool(filterManager);
    });

    test('returns profiles with active indicator', async () => {
        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        const parsed = JSON.parse(text);
        assert.ok(parsed.activeProfile, 'Should have activeProfile');
        assert.ok(Array.isArray(parsed.profiles), 'Should have profiles array');
        assert.ok(parsed.profiles.length > 0, 'Should have at least default profile');

        const active = parsed.profiles.find((p: { isActive: boolean }) => p.isActive);
        assert.ok(active, 'One profile should be active');
    });
});
