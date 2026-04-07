import * as assert from 'assert';
import * as vscode from 'vscode';

import { WorkflowManager } from '../../services/WorkflowManager';
import { ListWorkflowsTool } from '../../tools/ListWorkflowsTool';

suite('ListWorkflowsTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns empty message when no workflows', async () => {
        // Create a minimal mock WorkflowManager
        const mockWM = { getWorkflows: () => [] } as unknown as WorkflowManager;
        const tool = new ListWorkflowsTool(mockWM);

        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No workflows'));
    });

    test('returns workflow list with steps', async () => {
        const mockWM = {
            getWorkflows: () => [
                {
                    name: 'Test Workflow',
                    description: 'A test',
                    steps: [
                        { profileName: 'Profile A', executionMode: 'independent', description: 'Step 1' },
                        { profileName: 'Profile B', executionMode: 'aggregated', parentId: 'step1' },
                    ],
                },
            ],
        } as unknown as WorkflowManager;
        const tool = new ListWorkflowsTool(mockWM);

        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        const parsed = JSON.parse(text);
        assert.strictEqual(parsed.length, 1);
        assert.strictEqual(parsed[0].name, 'Test Workflow');
        assert.strictEqual(parsed[0].stepCount, 2);
        assert.strictEqual(parsed[0].steps[0].profileName, 'Profile A');
        assert.strictEqual(parsed[0].steps[1].executionMode, 'aggregated');
    });
});
