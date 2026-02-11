import * as vscode from 'vscode';
import { Constants } from '../constants';
import { WorkflowManager } from '../services/WorkflowManager';
import { SimulationStepResult } from '../models/Workflow';
import { FilterManager } from '../services/FilterManager';
import { Logger } from '../services/Logger';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export class WorkflowCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private workflowManager: WorkflowManager,
        private filterManager: FilterManager,
        private logger: Logger
    ) {
        this.registerCommands();
    }

    private registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.WorkflowOpenResult, async (stepResult: SimulationStepResult) => {
            if (stepResult && stepResult.outputFilePath) {
                await this.workflowManager.openStepResult(stepResult);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.runActive', async () => {
            await this.filterManager.saveFilters();
            const activeId = this.workflowManager.getActiveWorkflow();
            if (activeId) {
                let document = vscode.window.activeTextEditor?.document;

                // If no active editor (e.g. webview focused), try to find from visible editors
                if (!document) {
                    const visible = vscode.window.visibleTextEditors;
                    if (visible.length > 0) {
                        document = visible[0].document;
                    }
                }

                // If still no document, try to find from active tab group
                if (!document) {
                    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                    if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                        try {
                            document = await vscode.workspace.openTextDocument(activeTab.input.uri);
                        } catch (e) {
                            this.logger.error(`Failed to open document from tab: ${e}`);
                        }
                    }
                }

                if (document) {
                    // Check scheme
                    if (document.uri.scheme === 'file' || document.uri.scheme === 'untitled') {
                        await this.workflowManager.run(activeId, document);
                    } else {
                        vscode.window.showErrorMessage("Workflow can only run on file or untitled documents.");
                    }
                } else {
                    vscode.window.showErrorMessage("No active file found to run workflow on. Please open a log file.");
                }
            } else {
                vscode.window.showInformationMessage("No active workflow selected.");
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.run', async (item: vscode.TreeItem | string) => {
            await this.filterManager.saveFilters();
            let simId: string | undefined;
            if (typeof item === 'string') {
                simId = item;
            } else if (item && item.id) {
                simId = item.id;
            }

            if (simId) {
                // Reuse logic to find document
                let document = vscode.window.activeTextEditor?.document;
                if (!document) {
                    const visible = vscode.window.visibleTextEditors;
                    if (visible.length > 0) {
                        document = visible[0].document;
                    }
                }
                if (!document) {
                    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                    if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                        try {
                            document = await vscode.workspace.openTextDocument(activeTab.input.uri);
                        } catch (_e) { /* ignore */ }
                    }
                }

                if (document) {
                    if (document.uri.scheme === 'file' || document.uri.scheme === 'untitled') {
                        // Set active for visibility
                        await this.workflowManager.setActiveWorkflow(simId);
                        await this.workflowManager.run(simId, document);
                    } else {
                        vscode.window.showErrorMessage("Workflow can only run on file or untitled documents.");
                    }
                } else {
                    vscode.window.showErrorMessage("No active file found to run workflow on.");
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.setActive', async (id: string) => {
            await this.workflowManager.setActiveWorkflow(id);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.export', async () => {
            await this.handleExportWorkflow();
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.create', async () => {
            const name = await vscode.window.showInputBox({
                placeHolder: "Enter Workflow Name",
                prompt: "Create a new Workflow"
            });

            if (name) {
                await this.workflowManager.createWorkflow(name);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.import', async () => {
            await this.handleImportWorkflow();
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.openAllResults', async (args?: { id: string } | string) => {
            const workflowId = typeof args === 'string' ? args : args?.id;
            if (workflowId) {
                await this.workflowManager.openAllResults(workflowId);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.closeAllResults', async (args?: { id: string } | string) => {
            const workflowId = typeof args === 'string' ? args : args?.id;
            if (workflowId) {
                await this.workflowManager.closeAllResults(workflowId);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.workflow.rename', async (args?: { id: string } | string) => {
            const workflowId = typeof args === 'string' ? args : args?.id;
            if (workflowId) {
                const workflow = this.workflowManager.getWorkflow(workflowId);
                const newName = await vscode.window.showInputBox({
                    placeHolder: "Enter New Workflow Name",
                    prompt: "Rename Workflow",
                    value: workflow?.name
                });

                if (newName && newName !== workflow?.name) {
                    await this.workflowManager.renameWorkflow(workflowId, newName);
                }
            }
        }));
    }

    private async handleExportWorkflow() {
        const workflows = this.workflowManager.getWorkflows();
        if (workflows.length === 0) {
            vscode.window.showInformationMessage("No workflows to export.");
            return;
        }

        const selected = await vscode.window.showQuickPick(
            workflows.map(s => ({ label: s.name, description: s.id, workflow: s })),
            { placeHolder: "Select Workflow to Export" }
        );

        if (!selected) { return; }

        const json = await this.workflowManager.exportWorkflow(selected.workflow.id);
        if (!json) {
            vscode.window.showErrorMessage("Failed to export workflow.");
            return;
        }

        const safeName = selected.workflow.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `workflow_${safeName}.json`;

        const downloadsPath = path.join(os.homedir(), 'Downloads');
        let defaultUri = vscode.Uri.file(path.join(downloadsPath, fileName));
        if (!fs.existsSync(downloadsPath)) {
            defaultUri = vscode.Uri.file(path.join(os.homedir(), fileName));
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri,
            filters: { 'JSON': ['json'] },
            title: `Export Workflow: ${selected.workflow.name}`
        });

        if (uri) {
            try {
                fs.writeFileSync(uri.fsPath, json, 'utf8');
                vscode.window.showInformationMessage(`Workflow exported to ${uri.fsPath}`);
            } catch (err) {
                vscode.window.showErrorMessage(`Export failed: ${err}`);
            }
        }
    }

    private async handleImportWorkflow() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'JSON': ['json'] },
            title: "Import Workflow"
        });

        if (uris && uris.length > 0) {
            try {
                const json = fs.readFileSync(uris[0].fsPath, 'utf8');

                const success = await this.workflowManager.importWorkflow(json, async (profileName: string) => {
                    const choice = await vscode.window.showQuickPick(
                        [
                            { label: 'Create Copy', description: `Create a copy of '${profileName}' as '${profileName} (#)'`, value: 'copy' },
                            { label: 'Overwrite', description: `Replace existing profile '${profileName}'`, value: 'overwrite' },
                            { label: 'Cancel', description: 'Abort import', value: 'cancel' }
                        ],
                        {
                            placeHolder: `Conflict: Profile '${profileName}' already exists. How would you like to proceed?`,
                            ignoreFocusOut: true
                        }
                    );

                    if (!choice || choice.value === 'cancel') {
                        return 'cancel';
                    }

                    return choice.value as 'overwrite' | 'copy';
                });

                if (success) {
                    vscode.window.showInformationMessage("Workflow imported successfully.");
                } else {
                    // Failures or cancellations
                    this.logger.info("Import aborted or failed.");
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Import failed: ${err}`);
            }
        }
    }
}
