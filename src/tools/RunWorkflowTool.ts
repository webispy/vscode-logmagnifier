import * as vscode from 'vscode';

import { Logger } from '../services/Logger';
import { WorkflowManager } from '../services/WorkflowManager';

interface RunWorkflowInput {
    name: string;
}

/** Executes a saved workflow against the active log file. */
export class RunWorkflowTool implements vscode.LanguageModelTool<RunWorkflowInput> {
    constructor(
        private readonly workflowManager: WorkflowManager,
        private readonly logger: Logger
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RunWorkflowInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Running workflow "${options.input.name}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RunWorkflowInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { name } = options.input;

        const workflows = this.workflowManager.getWorkflows();
        const workflow = workflows.find(w => w.name === name);

        if (!workflow) {
            const available = workflows.map(w => w.name).join(', ');
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Workflow "${name}" not found.${available ? ` Available: ${available}` : ' No workflows configured.'}`
                )
            ]);
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor. Open a log file first.')
            ]);
        }

        try {
            await this.workflowManager.run(workflow.id, editor.document);

            const result = this.workflowManager.getLastRunResult(workflow.id);
            if (!result) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Workflow "${name}" completed but no results available.`)
                ]);
            }

            const stepSummaries = result.steps.map(s =>
                `Step ${s.stepIndex + 1} (${s.profileName}): ${s.matchedCount.toLocaleString()} lines matched`
            );

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Workflow "${name}" completed (${result.steps.length} steps).\n${stepSummaries.join('\n')}`
                )
            ]);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunWorkflowTool] Failed: ${msg}`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Workflow execution failed: ${msg}`)
            ]);
        }
    }
}
