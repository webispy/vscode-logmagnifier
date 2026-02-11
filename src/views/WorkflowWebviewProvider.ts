import * as vscode from 'vscode';
import { WorkflowManager } from '../services/WorkflowManager';
import { escapeHtml } from '../utils/WebviewUtils';
import { Constants } from '../constants';
import { WorkflowHtmlGenerator } from './WorkflowHtmlGenerator';

export class WorkflowWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = Constants.Views.Workflow;
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private readonly htmlGenerator: WorkflowHtmlGenerator;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly _workflowManager: WorkflowManager
    ) {
        this.htmlGenerator = new WorkflowHtmlGenerator(context);
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        try {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this.context.extensionUri
                ]
            };

            const workflows = await this._workflowManager.getWorkflowViewModels();
            const activeId = this._workflowManager.getActiveWorkflow();
            const activeStepId = this._workflowManager.getActiveStep();

            webviewView.webview.html = await this.htmlGenerator.generate(workflows, activeId, activeStepId);

            webviewView.webview.onDidReceiveMessage(async (data) => {
                switch (data.type) {
                    case 'import':
                        await vscode.commands.executeCommand(Constants.Commands.WorkflowImport);
                        break;
                    case 'export':
                        await vscode.commands.executeCommand(Constants.Commands.WorkflowExport);
                        break;
                    case 'run':
                        if (data.id) {
                            await vscode.commands.executeCommand(Constants.Commands.WorkflowRun, data.id);
                        }
                        break;
                    case 'delete':
                        if (data.id) {
                            const confirm = await vscode.window.showWarningMessage(
                                Constants.Messages.Warn.DeleteWorkflowConfirm.replace('{0}', data.name),
                                { modal: true },
                                'Delete'
                            );
                            if (confirm === 'Delete') {
                                await this._workflowManager.deleteWorkflow(data.id);
                            }
                        }
                        break;
                    case 'setActive':
                        if (data.id) {
                            await this._workflowManager.setActiveWorkflow(data.id);
                        }
                        break;
                    case 'clickWorkflow':
                        if (data.id) {
                            await this._workflowManager.handleWorkflowClick(data.id);
                            // The manager fires onDidChangeWorkflow, which triggers this.refresh() via listener
                        }
                        break;
                    case 'renameWorkflow':
                        if (data.id) {
                            const newName = await vscode.window.showInputBox({
                                prompt: Constants.Messages.Info.WorkflowInputName,
                                value: data.currentName
                            });
                            if (newName && newName.trim()) {
                                await this._workflowManager.renameWorkflow(data.id, newName.trim());
                            }
                        }
                        break;
                    case 'openFile':
                        if (data.path) {
                            const uri = vscode.Uri.file(data.path);
                            try {
                                // Check if file exists first? vscode.open handles it gracefully usually
                                await vscode.commands.executeCommand('vscode.open', uri);
                            } catch {
                                vscode.window.showErrorMessage(`Failed to open file: ${data.path}`);
                            }
                        }
                        break;
                    case 'openAllResults':
                        if (data.id) {
                            await this._workflowManager.openAllResults(data.id);
                        }
                        break;
                    case 'closeAllResults':
                        if (data.id) {
                            await this._workflowManager.closeAllResults(data.id);
                        }
                        break;
                    case 'addStep':
                        if (data.id) {
                            const profiles = this._workflowManager.getProfileNames();
                            const selected = await vscode.window.showQuickPick(profiles, {
                                placeHolder: Constants.Messages.Info.SelectProfileToAdd
                            });
                            if (selected) {
                                await this._workflowManager.addProfileToWorkflow(data.id, selected);
                                this.refresh();
                            }
                        }
                        break;
                    case 'removeStep':
                        if (data.id && data.stepId) {
                            const confirm = await vscode.window.showWarningMessage(
                                Constants.Messages.Warn.RemoveProfileConfirm.replace('{0}', data.name),
                                { modal: true },
                                'Remove'
                            );
                            if (confirm === 'Remove') {
                                await this._workflowManager.removeStepFromWorkflow(data.id, data.stepId);
                                this.refresh();
                            }
                        }
                        break;
                    case 'openProfile':
                        if (data.id && data.stepId) {
                            await this._workflowManager.activateStep(data.id, data.stepId);
                        }
                        break;
                    case 'moveStepUp':
                        if (data.id && data.stepId) {
                            await this._workflowManager.moveStepUp(data.id, data.stepId);
                            this.refresh();
                        }
                        break;
                    case 'moveStepDown':
                        if (data.id && data.stepId) {
                            await this._workflowManager.moveStepDown(data.id, data.stepId);
                            this.refresh();
                        }
                        break;
                }
            }, null, this._disposables);

            // Listen for changes
            this._workflowManager.onDidChangeWorkflow(() => {
                this.refresh();
            }, null, this._disposables);

            // Visibility changes
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    this.refresh();
                }
            }, null, this._disposables);

            // Cleanup when view is disposed
            webviewView.onDidDispose(() => {
                this._disposables.forEach(d => d.dispose());
                this._disposables = [];
            }, null, this._disposables);

        } catch (e) {
            console.error('Error resolving workflow webview:', e);
            webviewView.webview.html = `<html><body><div style="padding: 10px;">Error loading workflow view: ${escapeHtml(String(e))}</div></body></html>`;
        }
    }

    public async refresh() {
        if (this._view) {
            const workflows = await this._workflowManager.getWorkflowViewModels();
            const activeId = this._workflowManager.getActiveWorkflow();

            this._view.webview.postMessage({
                type: 'update',
                workflows: workflows,
                activeId: activeId,
                activeStepId: this._workflowManager.getActiveStep()
            });
        }
    }
}
