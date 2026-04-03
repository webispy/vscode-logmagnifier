import * as vscode from 'vscode';

import { WorkflowManager } from '../services/WorkflowManager';

/** Returns all saved workflows with their step configurations. */
export class ListWorkflowsTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly workflowManager: WorkflowManager) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const workflows = this.workflowManager.getWorkflows();

        if (workflows.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No workflows configured.')
            ]);
        }

        const result = workflows.map(w => ({
            name: w.name,
            description: w.description,
            stepCount: w.steps.length,
            steps: w.steps.map(s => ({
                profileName: s.profileName,
                executionMode: s.executionMode,
                parentId: s.parentId,
                description: s.description,
            })),
        }));

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
        ]);
    }
}
