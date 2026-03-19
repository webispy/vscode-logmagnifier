import * as vscode from 'vscode';
import { WorkflowManager } from '../services/WorkflowManager';
import { escapeHtml } from '../utils/WebviewUtils';
import { Constants } from '../Constants';
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

            webviewView.webview.html = await this.htmlGenerator.generate(webviewView.webview, workflows, activeId, activeStepId);

            webviewView.webview.onDidReceiveMessage(
                (data) => this.handleMessage(data),
                null, this._disposables
            );

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
            const disposeSubscription = webviewView.onDidDispose(() => {
                this._disposables.forEach(d => d.dispose());
                this._disposables = [];
                disposeSubscription.dispose();
            });

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleMessage(data: any): Promise<void> {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleRun(data: any): Promise<void> {
        if (data.id) {
            await vscode.commands.executeCommand(Constants.Commands.WorkflowRun, data.id);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleDelete(data: any): Promise<void> {
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
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleSetActive(data: any): Promise<void> {
        if (data.id) {
            await this._workflowManager.setActiveWorkflow(data.id);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleClickWorkflow(data: any): Promise<void> {
        if (data.id) {
            await this._workflowManager.handleWorkflowClick(data.id);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleRenameWorkflow(data: any): Promise<void> {
        if (data.id) {
            const newName = await vscode.window.showInputBox({
                prompt: Constants.Messages.Info.WorkflowInputName,
                value: data.currentName
            });
            if (newName && newName.trim()) {
                await this._workflowManager.renameWorkflow(data.id, newName.trim());
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleOpenFile(data: any): Promise<void> {
        if (data.path) {
            try {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(data.path));
            } catch {
                vscode.window.showErrorMessage(`Failed to open file: ${data.path}`);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleOpenAllResults(data: any): Promise<void> {
        if (data.id) {
            await this._workflowManager.openAllResults(data.id);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleCloseAllResults(data: any): Promise<void> {
        if (data.id) {
            await this._workflowManager.closeAllResults(data.id);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleAddStep(data: any): Promise<void> {
        if (!data.id) { return; }

        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = Constants.Messages.Info.SelectProfileToAdd;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        const refreshQuickPick = () => {
            const currentProfiles = this._workflowManager.getProfileNames();
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
                const profiles = this._workflowManager.getProfileNames();
                const newName = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterNewProfileName,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) { return 'Profile name cannot be empty'; }
                        if (profiles.includes(value.trim())) { return 'Profile with this name already exists'; }
                        return null;
                    }
                });
                if (newName) {
                    const success = await this._workflowManager.createEmptyProfile(newName.trim());
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
            await this._workflowManager.addProfileToWorkflow(data.id, profileNameToAdd, data.parentId);
            this.refresh();
        });

        quickPick.onDidTriggerItemButton(async (e) => {
            const profileName = e.item.label;
            if (e.button.tooltip === 'Rename Profile') {
                const profiles = this._workflowManager.getProfileNames();
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
                    const success = await this._workflowManager.renameProfile(profileName, newName.trim());
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
                    const success = await this._workflowManager.deleteProfile(profileName);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleRemoveStep(data: any): Promise<void> {
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
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleOpenProfile(data: any): Promise<void> {
        if (data.id && data.stepId) {
            await this._workflowManager.activateStep(data.id, data.stepId);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleMoveStep(data: any, direction: 'up' | 'down'): Promise<void> {
        if (data.id && data.stepId) {
            if (direction === 'up') {
                await this._workflowManager.moveStepUp(data.id, data.stepId);
            } else {
                await this._workflowManager.moveStepDown(data.id, data.stepId);
            }
            this.refresh();
        }
    }
}
