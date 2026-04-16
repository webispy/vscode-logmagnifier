import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { WorkflowWebviewMessage } from '../models/WebviewModels';

import { Logger } from '../services/Logger';
import { WorkflowManager } from '../services/WorkflowManager';
import { escapeHtml } from '../utils/WebviewUtils';
import { WorkflowHtmlGenerator } from './WorkflowHtmlGenerator';

export class WorkflowWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewType = Constants.Views.Workflow;
    private view?: vscode.WebviewView;
    private disposables: vscode.Disposable[] = [];
    private readonly htmlGenerator: WorkflowHtmlGenerator;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly workflowManager: WorkflowManager,
        private readonly logger: Logger
    ) {
        this.htmlGenerator = new WorkflowHtmlGenerator(context, logger);
    }

    /** Initializes the workflow webview with HTML content and registers message handlers. */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.view = webviewView;

        try {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this.context.extensionUri
                ]
            };

            const workflows = await this.workflowManager.getWorkflowViewModels();
            const activeId = this.workflowManager.getActiveWorkflow();
            const activeStepId = this.workflowManager.getActiveStep();

            webviewView.webview.html = await this.htmlGenerator.generate(webviewView.webview, workflows, activeId, activeStepId);

            webviewView.webview.onDidReceiveMessage(
                (data) => this.handleMessage(data),
                null, this.disposables
            );

            // Listen for changes
            this.workflowManager.onDidChangeWorkflow(() => {
                this.refresh().catch((e: unknown) =>
                    this.logger.error(`[WorkflowWebviewProvider] Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
                );
            }, null, this.disposables);

            // Visibility changes
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    this.refresh().catch((e: unknown) =>
                        this.logger.error(`[WorkflowWebviewProvider] Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
                    );
                }
            }, null, this.disposables);

            // Cleanup when view is disposed
            webviewView.onDidDispose(() => {
                this.disposables.forEach(d => d.dispose());
                this.disposables = [];
            }, null, this.disposables);

        } catch (e: unknown) {
            this.logger.error(`[WorkflowWebviewProvider] Error resolving webview: ${e instanceof Error ? e.message : String(e)}`);
            webviewView.webview.html = `<html><body><div style="padding: 10px;">Error loading workflow view: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div></body></html>`;
        }
    }

    /** Sends updated workflow data to the webview via postMessage. */
    public async refresh() {
        if (this.view) {
            const workflows = await this.workflowManager.getWorkflowViewModels();
            const activeId = this.workflowManager.getActiveWorkflow();

            this.view.webview.postMessage({
                type: 'update',
                workflows: workflows,
                activeId: activeId,
                activeStepId: this.workflowManager.getActiveStep()
            });
        }
    }

    private async handleMessage(data: WorkflowWebviewMessage): Promise<void> {
        switch (data.type) {
            case 'import': return this.handleImport();
            case 'export': return this.handleExport();
            case 'run': return this.handleRun(data);
            case 'delete': return this.handleDelete(data);
            case 'setActive': return this.handleSetActive(data);
            case 'clickWorkflow': return this.handleClickWorkflow(data);
            case 'renameWorkflow': return this.handleRenameWorkflow(data);
            case 'openFile': return this.handleOpenFile(data);
            case 'openAllResults': return this.handleOpenAllResults(data);
            case 'closeAllResults': return this.handleCloseAllResults(data);
            case 'addStep': return this.handleAddStep(data);
            case 'removeStep': return this.handleRemoveStep(data);
            case 'openProfile': return this.handleOpenProfile(data);
            case 'moveStepUp': return this.handleMoveStep(data, 'up');
            case 'moveStepDown': return this.handleMoveStep(data, 'down');
        }
    }

    private async handleImport(): Promise<void> {
        await vscode.commands.executeCommand(Constants.Commands.WorkflowImport);
    }

    private async handleExport(): Promise<void> {
        await vscode.commands.executeCommand(Constants.Commands.WorkflowExport);
    }

    private async handleRun(data: Extract<WorkflowWebviewMessage, { type: 'run' }>): Promise<void> {
        await vscode.commands.executeCommand(Constants.Commands.WorkflowRun, data.id);
    }

    private async handleDelete(data: Extract<WorkflowWebviewMessage, { type: 'delete' }>): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            Constants.Messages.Warn.DeleteWorkflowConfirm.replace('{0}', data.name),
            { modal: true },
            'Delete'
        );
        if (confirm === 'Delete') {
            await this.workflowManager.deleteWorkflow(data.id);
        }
    }

    private async handleSetActive(data: Extract<WorkflowWebviewMessage, { type: 'setActive' }>): Promise<void> {
        await this.workflowManager.setActiveWorkflow(data.id);
    }

    private async handleClickWorkflow(data: Extract<WorkflowWebviewMessage, { type: 'clickWorkflow' }>): Promise<void> {
        await this.workflowManager.handleWorkflowClick(data.id);
    }

    private async handleRenameWorkflow(data: Extract<WorkflowWebviewMessage, { type: 'renameWorkflow' }>): Promise<void> {
        const newName = await vscode.window.showInputBox({
            prompt: Constants.Messages.Info.WorkflowInputName,
            value: data.currentName
        });
        if (newName && newName.trim()) {
            await this.workflowManager.renameWorkflow(data.id, newName.trim());
        }
    }

    private async handleOpenFile(data: Extract<WorkflowWebviewMessage, { type: 'openFile' }>): Promise<void> {
        try {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(data.path));
        } catch (e: unknown) {
            this.logger.warn(`[WorkflowWebviewProvider] Failed to open file: ${e instanceof Error ? e.message : String(e)}`);
            vscode.window.showErrorMessage(`Failed to open file: ${data.path}`);
        }
    }

    private async handleOpenAllResults(data: Extract<WorkflowWebviewMessage, { type: 'openAllResults' }>): Promise<void> {
        await this.workflowManager.openAllResults(data.id);
    }

    private async handleCloseAllResults(data: Extract<WorkflowWebviewMessage, { type: 'closeAllResults' }>): Promise<void> {
        await this.workflowManager.closeAllResults(data.id);
    }

    private async handleAddStep(data: Extract<WorkflowWebviewMessage, { type: 'addStep' }>): Promise<void> {

        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = Constants.Messages.Info.SelectProfileToAdd;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        const refreshQuickPick = () => {
            const currentProfiles = this.workflowManager.getProfileNames();
            const createProfileItem: vscode.QuickPickItem = {
                label: `$(plus) Create New Profile...`,
                alwaysShow: true
            };
            const separatorItem: vscode.QuickPickItem = {
                label: '',
                kind: vscode.QuickPickItemKind.Separator
            };
            const buildItem = (p: string) => {
                const buttons: vscode.QuickInputButton[] = [];
                if (p !== Constants.Labels.DefaultProfile) {
                    buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Rename Profile' });
                    buttons.push({ iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete Profile' });
                }
                return { label: p, buttons };
            };
            quickPick.items = [createProfileItem, separatorItem, ...currentProfiles.map(buildItem)];
        };

        refreshQuickPick();

        quickPick.onDidAccept(async () => {
            const selection = quickPick.selectedItems[0];
            if (!selection) { return; }

            let profileNameToAdd = selection.label;
            if (selection.label === `$(plus) Create New Profile...`) {
                const profiles = this.workflowManager.getProfileNames();
                const newName = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterNewProfileName,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) { return 'Profile name cannot be empty'; }
                        if (profiles.includes(value.trim())) { return 'Profile with this name already exists'; }
                        return null;
                    }
                });
                if (newName) {
                    const success = await this.workflowManager.createEmptyProfile(newName.trim());
                    if (success) {
                        profileNameToAdd = newName.trim();
                        vscode.window.showInformationMessage(Constants.Messages.Info.ProfileCreated.replace('{0}', profileNameToAdd));
                        refreshQuickPick();
                    } else {
                        vscode.window.showErrorMessage(Constants.Messages.Error.ProfileCreateFailed.replace('{0}', newName.trim()));
                        return;
                    }
                } else {
                    return;
                }
            }

            quickPick.hide();
            await this.workflowManager.addProfileToWorkflow(data.id, profileNameToAdd, data.parentId);
            this.refresh().catch((e: unknown) =>
                this.logger.error(`[WorkflowWebviewProvider] Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
            );
        });

        quickPick.onDidTriggerItemButton(async (e) => {
            const profileName = e.item.label;
            if (e.button.tooltip === 'Rename Profile') {
                const profiles = this.workflowManager.getProfileNames();
                const newName = await vscode.window.showInputBox({
                    prompt: `Enter new name for profile '${profileName}'`,
                    value: profileName,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) { return 'Profile name cannot be empty'; }
                        if (value.trim() !== profileName && profiles.includes(value.trim())) { return 'Profile with this name already exists'; }
                        return null;
                    }
                });
                if (newName && newName.trim() !== profileName) {
                    const success = await this.workflowManager.renameProfile(profileName, newName.trim());
                    if (success) {
                        vscode.window.showInformationMessage(`Profile renamed to '${newName.trim()}'`);
                        refreshQuickPick();
                    } else {
                        vscode.window.showErrorMessage(`Failed to rename profile '${profileName}'`);
                    }
                }
            } else if (e.button.tooltip === 'Delete Profile') {
                const confirm = await vscode.window.showWarningMessage(
                    Constants.Messages.Warn.ConfirmDeleteProfile.replace('{0}', profileName),
                    { modal: true },
                    'Delete'
                );
                if (confirm === 'Delete') {
                    const success = await this.workflowManager.deleteProfile(profileName);
                    if (success) {
                        vscode.window.showInformationMessage(Constants.Messages.Info.ProfileDeleted.replace('{0}', profileName));
                        refreshQuickPick();
                    } else {
                        vscode.window.showErrorMessage(`Failed to delete profile '${profileName}'`);
                    }
                }
            }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    }

    private async handleRemoveStep(data: Extract<WorkflowWebviewMessage, { type: 'removeStep' }>): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            Constants.Messages.Warn.RemoveProfileConfirm.replace('{0}', data.name),
            { modal: true },
            'Remove'
        );
        if (confirm === 'Remove') {
            await this.workflowManager.removeStepFromWorkflow(data.id, data.stepId);
            this.refresh().catch((e: unknown) =>
                this.logger.error(`[WorkflowWebviewProvider] Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
            );
        }
    }

    private async handleOpenProfile(data: Extract<WorkflowWebviewMessage, { type: 'openProfile' }>): Promise<void> {
        await this.workflowManager.activateStep(data.id, data.stepId);
    }

    private async handleMoveStep(data: Extract<WorkflowWebviewMessage, { type: 'moveStepUp' | 'moveStepDown' }>, direction: 'up' | 'down'): Promise<void> {
        if (direction === 'up') {
            await this.workflowManager.moveStepUp(data.id, data.stepId);
        } else {
            await this.workflowManager.moveStepDown(data.id, data.stepId);
        }
        this.refresh().catch((e: unknown) =>
            this.logger.error(`[WorkflowWebviewProvider] Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
        );
    }

    /** Disposes all subscriptions. */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
