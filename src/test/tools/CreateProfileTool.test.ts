import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { CreateProfileTool } from '../../tools/CreateProfileTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('CreateProfileTool', () => {
    let filterManager: FilterManager;
    let tool: CreateProfileTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new CreateProfileTool(filterManager);
    });

    test('creates empty profile when copyFrom is omitted', async () => {
        const result = await tool.invoke(
            { input: { name: 'EmptyProfile' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('EmptyProfile'), 'Should mention profile name');
        assert.ok(text.includes('0 total filter(s)'), 'Should have no filters');
        assert.ok(filterManager.getProfileNames().includes('EmptyProfile'));
    });

    test('creates profile from current filters when copyFrom is "current"', async () => {
        // Add some filters to current state
        const group = filterManager.addGroup('TestGroup', false)!;
        filterManager.addFilter(group.id, 'ERROR', 'include', false);

        const result = await tool.invoke(
            { input: { name: 'Snapshot', copyFrom: 'current' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Snapshot'), 'Should mention profile name');
        assert.ok(filterManager.getProfileNames().includes('Snapshot'));

        // Verify filters were copied
        const groups = filterManager.getGroups();
        const testGroup = groups.find(g => g.name === 'TestGroup');
        assert.ok(testGroup, 'TestGroup should exist in new profile');
    });

    test('creates profile copied from another profile', async () => {
        // Create source profile with filters
        const group = filterManager.addGroup('SourceGroup', false)!;
        filterManager.addFilter(group.id, 'FATAL', 'include', false);
        await filterManager.saveProfile('Source');

        // Switch away
        await filterManager.createProfile('Temp');

        const result = await tool.invoke(
            { input: { name: 'Copied', copyFrom: 'Source' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Copied'), 'Should mention profile name');
        assert.ok(filterManager.getProfileNames().includes('Copied'));
    });

    test('returns error for duplicate name', async () => {
        await filterManager.createProfile('Existing');

        const result = await tool.invoke(
            { input: { name: 'Existing' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('already exists'), 'Should indicate duplicate');
    });

    test('returns error for non-existent source profile', async () => {
        const result = await tool.invoke(
            { input: { name: 'New', copyFrom: 'NonExistent' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'), 'Should indicate source not found');
    });

    test('prepareInvocation shows source info', async () => {
        const emptyPrepared = await tool.prepareInvocation(
            { input: { name: 'A' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ name: string }>,
            token
        );
        assert.ok(emptyPrepared.invocationMessage);
        assert.ok(String(emptyPrepared.invocationMessage).includes('(empty)'));

        const currentPrepared = await tool.prepareInvocation(
            { input: { name: 'B', copyFrom: 'current' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ name: string; copyFrom: string }>,
            token
        );
        assert.ok(String(currentPrepared.invocationMessage).includes('current filters'));

        const profilePrepared = await tool.prepareInvocation(
            { input: { name: 'C', copyFrom: 'MyProfile' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ name: string; copyFrom: string }>,
            token
        );
        assert.ok(String(profilePrepared.invocationMessage).includes('MyProfile'));
    });
});
