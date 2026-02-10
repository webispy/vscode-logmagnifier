import * as vscode from 'vscode';
import { WorkflowManager, WorkflowViewModel } from '../services/WorkflowManager';

export class SidebarWorkflowWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'logmagnifier-workflow';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _workflowManager: WorkflowManager
    ) { }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        const workflows = await this._workflowManager.getWorkflowViewModels();
        const activeId = this._workflowManager.getActiveWorkflow();
        webviewView.webview.html = this._getHtmlForWebview(workflows, activeId);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'import':
                    await vscode.commands.executeCommand('logmagnifier.workflow.import');
                    break;
                case 'export':
                    await vscode.commands.executeCommand('logmagnifier.workflow.export');
                    break;
                case 'run':
                    if (data.id) {
                        await vscode.commands.executeCommand('logmagnifier.workflow.run', data.id);
                    }
                    break;
                case 'delete':
                    if (data.id) {
                        const confirm = await vscode.window.showWarningMessage(
                            `Are you sure you want to delete workflow '${data.name}'?`,
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
                            prompt: 'Enter new name for Workflow',
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
                            placeHolder: 'Select a profile to add to the workflow'
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
                            `Remove profile '${data.name}' from workflow?`,
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
        });

        // Listen for changes
        this._workflowManager.onDidChangeWorkflow(() => {
            this.refresh();
        });
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

    private _getHtmlForWebview(workflows: WorkflowViewModel[], activeId: string | undefined) {
        // activeId is actually passed via message update usually, but for initial render we might need it.
        // However, we rely on the message update mostly. Let's ensure initial render has it too if needed,
        // but `render()` uses the variable `activeId` and `activeStepId`.

        // Colors for the graph lines (Git Graph style)
        const graphColors = [
            'var(--vscode-charts-blue)',
            'var(--vscode-charts-red)',
            'var(--vscode-charts-green)',
            'var(--vscode-charts-yellow)',
            'var(--vscode-charts-orange)',
            'var(--vscode-charts-purple)'
        ];

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Workflows</title>
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }
                .button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 8px;
                    cursor: pointer;
                    font-size: 11px;
                    border-radius: 2px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .button-secondary {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .button-secondary:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                #graph-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0;
                }
                
                /* NODES & ROWS */
                .workflow-node {
                    display: flex;
                    align-items: flex-start;
                    flex-direction: column;
                    position: relative;
                    user-select: none;
                }
                .node-row, .profile-row {
                    display: flex;
                    align-items: center;
                    height: 22px; /* Standard TreeView Height */
                    width: 100%;
                    cursor: pointer;
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                /* HOVER & SELECTION */
                .node-row:hover, .profile-row:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    color: var(--vscode-list-hoverForeground);
                }
                /* Active (Focused) */
                body.is-focused .node-row.is-active, body.is-focused .profile-row.is-active {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
                /* Active (Blurred/Inactive) */
                .node-row.is-active, .profile-row.is-active {
                    background-color: var(--vscode-list-inactiveSelectionBackground);
                    color: var(--vscode-list-inactiveSelectionForeground);
                }
                
                /* BOLD TEXT FOR ACTIVE ITEMS */
                .is-active .workflow-name, .is-active .profile-name {
                     font-weight: bold;
                }

                /* GRAPH RAIL */
                .graph-rail {
                    width: 30px;
                    flex-shrink: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100%;
                }

                /* CONTENT LAYOUT */
                .content {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding-right: 8px;
                }
                .workflow-name, .profile-name {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    font-size: 13px;
                }
                
                /* ACTIONS (Hidden by default, show on hover) */
                .actions {
                    display: none;
                    gap: 2px;
                    margin-left: auto;
                    padding-right: 4px;
                }
                .node-row:hover .actions, .profile-row:hover .actions {
                    display: flex;
                    align-items: center;
                }
                
                .icon-btn {
                    background: transparent;
                    border: none;
                    color: var(--vscode-icon-foreground);
                    cursor: pointer;
                    padding: 2px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 18px;
                    height: 18px;
                    border-radius: 3px;
                }
                
                /* Ensure icons are visible on active selection */
                body.is-focused .node-row.is-active .icon-btn, 
                body.is-focused .profile-row.is-active .icon-btn {
                     color: var(--vscode-list-activeSelectionForeground);
                }
                .icon-btn:hover {
                    background-color: var(--vscode-toolbar-hoverBackground);
                    color: var(--vscode-foreground);
                }

                /* PROFILE SPECIFICS */
                .profile-steps-container {
                    display: none;
                    flex-direction: column;
                    width: 100%;
                }
                .workflow-node.expanded .profile-steps-container {
                    display: flex;
                }
                .profile-step {
                    display: flex;
                    flex-direction: column;
                }

                /* FILTERS */
                .filter-group {
                    margin-left: 30px;
                    margin-top: 4px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    border-left: 1px dotted var(--vscode-tree-indentGuidesStroke);
                    padding-left: 8px;
                }
                .filter-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 1px 0;
                }
                .filter-keyword {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 0px 4px;
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 0.85em;
                }

                .file-badge {
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    border-radius: 11px;
                    padding: 1px 6px;
                    font-size: 0.85em;
                    margin-left: 8px;
                    display: inline-block;
                    line-height: normal;
                }
                .is-missing {
                    text-decoration: line-through;
                    opacity: 0.6;
                }
            </style>
        </head>
        <body>
            <div id="graph-container"></div>

            <script>
                const vscode = acquireVsCodeApi();
                const container = document.getElementById('graph-container');
                let workflows = ${JSON.stringify(workflows)};
                let activeId = "${activeId || ''}";
                let activeStepId = "${this._workflowManager.getActiveStep() || ''}"; // Note: using direct injection here might be cleaner
                const colors = ${JSON.stringify(graphColors)};

                // Icons (VS Code Codicons)
                const icons = {
                    'search': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12.9579 6.04035C12.7426 4.87867 11.7238 4 10.5 4H7.20702L5.64602 2.439C5.36502 2.158 4.98302 2 4.58502 2H3.49902C2.11802 2 0.999023 3.119 0.999023 4.5V7.261C1.30602 7.007 1.64202 6.79 1.99902 6.607V4.5C1.99902 3.672 2.67102 3 3.49902 3H4.58502C4.71802 3 4.84502 3.053 4.93902 3.146L6.64602 4.853C6.74002 4.947 6.86702 4.999 7.00002 4.999H10.5C11.153 4.999 11.709 5.416 11.915 5.999H5.52202C5.44599 5.999 5.37323 6.01206 5.30034 6.02515C5.25915 6.03254 5.21791 6.03994 5.17602 6.045C6.08902 6.158 6.93302 6.494 7.65202 6.999H12.496C13.651 6.999 14.372 8.249 13.795 9.249L12.21 11.994C11.853 12.613 11.192 12.994 10.478 12.994H9.78702C9.68802 13.343 9.55602 13.677 9.39402 13.994H10.477C11.549 13.994 12.539 13.422 13.075 12.494L14.66 9.749C15.5427 8.22058 14.6037 6.34143 12.9579 6.04035Z"/><path d="M4.5 14C5.881 14 7 12.881 7 11.5C7 10.119 5.881 9 4.5 9C3.119 9 2 10.119 2 11.5C2 12.881 3.119 14 4.5 14Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M0 11.5C0 9.019 2.019 7 4.5 7C6.981 7 9 9.019 9 11.5C9 13.981 6.981 16 4.5 16C2.019 16 0 13.981 0 11.5ZM1 11.5C1 13.43 2.57 15 4.5 15C6.43 15 8 13.43 8 11.5C8 9.57 6.43 8 4.5 8C2.57 8 1 9.57 1 11.5Z"/></svg>', // root-folder-opened
                    'close-all': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 7C2.019 7 0 9.019 0 11.5C0 13.981 2.019 16 4.5 16C6.981 16 9 13.981 9 11.5C9 9.019 6.981 7 4.5 7ZM4.5 15C2.57 15 1 13.43 1 11.5C1 9.57 2.57 8 4.5 8C6.43 8 8 9.57 8 11.5C8 13.43 6.43 15 4.5 15ZM7 11.5C7 12.881 5.881 14 4.5 14C3.119 14 2 12.881 2 11.5C2 10.119 3.119 9 4.5 9C5.881 9 7 10.119 7 11.5ZM15 6.5V11.5C15 12.881 13.881 14 12.5 14H10V13H12.5C13.328 13 14 12.328 14 11.5V6.5C14 5.672 13.328 5 12.5 5H8.207L7.207 6H5.586C5.719 6 5.846 5.947 5.94 5.854L7.294 4.5L5.94 3.146C5.846 3.052 5.719 3 5.586 3H3.5C2.672 3 2 3.672 2 4.5V6H1V4.5C1 3.119 2.119 2 3.5 2H5.586C5.984 2 6.365 2.158 6.647 2.439L8.208 4H12.501C13.882 4 15.001 5.119 15.001 6.5H15Z"/></svg>', // root-folder
                    'add': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>',
                    'trash': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H10C10 0.897 9.103 0 8 0C6.897 0 6 0.897 6 2H2C1.724 2 1.5 2.224 1.5 2.5C1.5 2.776 1.724 3 2 3H2.54L3.349 12.708C3.456 13.994 4.55 15 5.84 15H10.159C11.449 15 12.543 13.993 12.65 12.708L13.459 3H13.999C14.275 3 14.499 2.776 14.499 2.5C14.499 2.224 14.275 2 13.999 2H14ZM8 1C8.551 1 9 1.449 9 2H7C7 1.449 7.449 1 8 1ZM11.655 12.625C11.591 13.396 10.934 14 10.16 14H5.841C5.067 14 4.41 13.396 4.346 12.625L3.544 3H12.458L11.656 12.625H11.655ZM7 5.5V11.5C7 11.776 6.776 12 6.5 12C6.224 12 6 11.776 6 11.5V5.5C6 5.224 6.224 5 6.5 5C6.776 5 7 5.224 7 5.5ZM10 5.5V11.5C10 11.776 9.776 12 9.5 12C9.224 12 9 11.776 9 11.5V5.5C9 5.224 9.224 5 9.5 5C9.776 5 10 5.224 10 5.5Z"/></svg>',
                    'play': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3.43934 13.5569C3.72064 13.8382 4.10218 13.9962 4.5 13.9962C4.75753 13.9943 5.01038 13.9272 5.235 13.8012L13.235 9.30123C13.4661 9.17048 13.6583 8.98073 13.7921 8.75136C13.9258 8.522 13.9963 8.26125 13.9963 7.99573C13.9963 7.73022 13.9258 7.46946 13.7921 7.2401C13.6583 7.01074 13.4661 6.82099 13.235 6.69023L5.225 2.18423C4.99595 2.06392 4.73997 2.00411 4.48133 2.01047C4.22269 2.01682 3.96996 2.08914 3.7471 2.22055C3.52423 2.35196 3.33863 2.53812 3.20789 2.76137C3.07714 2.98462 3.00558 3.23757 3 3.49623V12.4962C3 12.8941 3.15804 13.2756 3.43934 13.5569ZM4.14645 3.14268C4.24021 3.04891 4.36739 2.99623 4.5 2.99623C4.58579 2.99723 4.66999 3.01957 4.745 3.06123L12.745 7.56123C12.8219 7.60484 12.886 7.66808 12.9305 7.7445C12.975 7.82092 12.9985 7.90779 12.9985 7.99623C12.9985 8.08468 12.975 8.17154 12.9305 8.24796C12.886 8.32438 12.8219 8.38762 12.745 8.43123L4.755 12.9252C4.67964 12.9729 4.59272 12.9993 4.50355 13.0014C4.41438 13.0035 4.32631 12.9814 4.24876 12.9373C4.17121 12.8932 4.10709 12.8289 4.06328 12.7512C4.01946 12.6735 3.99759 12.5854 4 12.4962V3.49623C4 3.36362 4.05268 3.23645 4.14645 3.14268ZM10.76 11.8362L11.98 11.1562C11.992 11.2391 11.9987 11.3226 12 11.4062C11.9997 11.6721 11.9293 11.9333 11.7958 12.1632C11.6624 12.3932 11.4707 12.584 11.24 12.7162L6.16 15.5762C5.64826 15.8471 5.07898 15.9911 4.5 15.9962C4.19188 15.9987 3.88513 15.9548 3.59 15.8662C2.98312 15.7119 2.43205 15.3895 2 14.9362C1.35803 14.2865 0.99862 13.4096 1 12.4962V6.90624C1.00252 6.59959 1.10003 6.30126 1.27912 6.05233C1.45821 5.80339 1.71006 5.6161 2 5.51624V12.4962C2.00429 12.9285 2.12001 13.3523 2.33598 13.7268C2.55195 14.1013 2.86087 14.4137 3.23287 14.6339C3.60487 14.8541 4.02738 14.9746 4.45957 14.9837C4.89175 14.9929 5.319 14.8904 5.7 14.6862L10.75 11.8462C10.7527 11.8462 10.7552 11.8452 10.7571 11.8433C10.759 11.8414 10.76 11.8389 10.76 11.8362Z"/></svg>', // run-all
                    'arrow-up': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.854 7.14576L8.85401 2.14576C8.65901 1.95076 8.34201 1.95076 8.14701 2.14576L3.14601 7.14576C2.95101 7.34076 2.95101 7.65776 3.14601 7.85276C3.34101 8.04776 3.65801 8.04776 3.85301 7.85276L7.99901 3.70676V13.4998C7.99901 13.7758 8.22301 13.9998 8.49901 13.9998C8.77501 13.9998 8.99901 13.7758 8.99901 13.4998V3.70676L13.145 7.85276C13.243 7.95076 13.371 7.99876 13.499 7.99876C13.627 7.99876 13.755 7.94976 13.853 7.85276C14.048 7.65776 14.048 7.34076 13.853 7.14576H13.854Z"/></svg>',
                    'arrow-down': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.854 8.146C13.659 7.951 13.342 7.951 13.147 8.146L9.00096 12.292V2.5C9.00096 2.224 8.77696 2 8.50096 2C8.22496 2 8.00096 2.224 8.00096 2.5V12.293L3.85496 8.147C3.65996 7.952 3.34296 7.952 3.14796 8.147C2.95296 8.342 2.95296 8.659 3.14796 8.854L8.14796 13.854C8.24596 13.952 8.37396 14 8.50196 14C8.62996 14 8.75796 13.951 8.85596 13.854L13.856 8.854C14.051 8.659 14.051 8.342 13.856 8.147L13.854 8.146Z"/></svg>',
                    'edit': '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M14.236 1.76386C13.2123 0.740172 11.5525 0.740171 10.5289 1.76386L2.65722 9.63549C2.28304 10.0097 2.01623 10.4775 1.88467 10.99L1.01571 14.3755C0.971767 14.5467 1.02148 14.7284 1.14646 14.8534C1.27144 14.9783 1.45312 15.028 1.62432 14.9841L5.00978 14.1151C5.52234 13.9836 5.99015 13.7168 6.36433 13.3426L14.236 5.47097C15.2596 4.44728 15.2596 2.78755 14.236 1.76386ZM11.236 2.47097C11.8691 1.8378 12.8957 1.8378 13.5288 2.47097C14.162 3.10413 14.162 4.1307 13.5288 4.76386L12.75 5.54269L10.4571 3.24979L11.236 2.47097ZM9.75002 3.9569L12.0429 6.24979L5.65722 12.6355C5.40969 12.883 5.10023 13.0595 4.76117 13.1465L2.19447 13.8053L2.85327 11.2386C2.9403 10.8996 3.1168 10.5901 3.36433 10.3426L9.75002 3.9569Z"/></svg>'
                };

                function post(type, data = {}) {
                    vscode.postMessage({ type, ...data });
                }

                function render() {
                    container.innerHTML = '';
                    if (workflows.length === 0) {
                        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">No worklows created.<br>Click "+" in the menu or use Command Palette to create one.</div>';
                        return;
                    }
                    workflows.forEach((workflow, index) => {
                        const color = colors[index % colors.length];
                        const isWorkflowActive = (activeId === workflow.id && !activeStepId);
                        const isExpanded = workflow.isExpanded; // Use backend state
                        const hasProfiles = workflow.profiles && workflow.profiles.length > 0;
                        
                        const el = document.createElement('div');
                        el.className = 'workflow-node ' + (isExpanded ? 'expanded' : '');
                        
                        // 1. Workflow Node Row
                        const row = document.createElement('div');
                        row.className = 'node-row';
                        if (isWorkflowActive) row.classList.add('is-active');
                        
                        // Interaction: Delegate to backend
                        row.onclick = () => {
                            post('clickWorkflow', { id: workflow.id });
                        };
                        
                        // Rail
                        const rail = document.createElement('div');
                        rail.className = 'graph-rail';
                        rail.style.color = color;
                        
                        const svgNs = "http://www.w3.org/2000/svg";
                        const sSvg = document.createElementNS(svgNs, "svg");
                        sSvg.setAttribute("width", "30");
                        sSvg.setAttribute("height", "22");
                        sSvg.setAttribute("viewBox", "0 0 30 22");
                        
                        if (isExpanded && hasProfiles) {
                            const line = document.createElementNS(svgNs, "line");
                            line.setAttribute("x1", "15");
                            line.setAttribute("y1", "11");
                            line.setAttribute("x2", "15");
                            line.setAttribute("y2", "22");
                            line.setAttribute("stroke", color);
                            line.setAttribute("stroke-width", "2");
                            sSvg.appendChild(line);
                        }
                        
                        // Dot (Ring Style)
                        const circle = document.createElementNS(svgNs, "circle");
                        circle.setAttribute("cx", "15");
                        circle.setAttribute("cy", "11");
                        
                        // Active: Same Radius (r=4.5), Thicker Stroke
                        circle.setAttribute("r", "4.5");
                        
                        // Ring styling: Fill matches background to hide line
                        circle.setAttribute("fill", "var(--vscode-sideBar-background)"); 
                        circle.setAttribute("stroke", color);
                        
                        // Thicker stroke when active
                        const strokeWidth = isWorkflowActive ? "3" : "2";
                        circle.setAttribute("stroke-width", strokeWidth);

                        sSvg.appendChild(circle);
                        rail.appendChild(sSvg);
                        row.appendChild(rail);
                        
                        // Content
                        const content = document.createElement('div');
                        content.className = 'content';
                        
                        const nameSpan = document.createElement('span');
                        nameSpan.className = 'workflow-name';
                        nameSpan.innerText = workflow.name;
                        if (isWorkflowActive) nameSpan.style.fontWeight = 'bold';
                        
                        content.appendChild(nameSpan);

                        if (workflow.lastRunFile) {
                            const fileName = workflow.lastRunFile.split(/[\\/]/).pop();
                            if (fileName) {
                                const badge = document.createElement('span');
                                badge.className = 'file-badge';
                                badge.innerText = fileName;
                                badge.style.backgroundColor = color;
                                badge.style.color = 'var(--vscode-editor-background)';
                                content.appendChild(badge);
                            }
                        }

                        const actions = document.createElement('div');
                        actions.className = 'actions';
                        
                        const renameBtn = createBtn('edit', 'Rename Workflow');
                        renameBtn.onclick = (e) => { e.stopPropagation(); post('renameWorkflow', { id: workflow.id, currentName: workflow.name }); };

                        const openAllBtn = createBtn('search', 'Open All Results');
                        openAllBtn.onclick = (e) => { e.stopPropagation(); post('openAllResults', { id: workflow.id }); };
                        
                        const closeAllBtn = createBtn('close-all', 'Close All Results');
                        closeAllBtn.onclick = (e) => { e.stopPropagation(); post('closeAllResults', { id: workflow.id }); };

                        const addBtn = createBtn('add', 'Add Profile');
                        addBtn.onclick = (e) => { e.stopPropagation(); post('addStep', { id: workflow.id }); };
                        
                        const deleteBtn = createBtn('trash', 'Delete Workflow');
                        deleteBtn.onclick = (e) => { e.stopPropagation(); post('delete', { id: workflow.id, name: workflow.name }); };

                        const runBtn = createBtn('play', 'Run Workflow');
                        runBtn.onclick = (e) => { e.stopPropagation(); post('run', { id: workflow.id }); };
                        
                        actions.appendChild(renameBtn);
                        actions.appendChild(openAllBtn);
                        actions.appendChild(closeAllBtn);
                        actions.appendChild(addBtn);
                        actions.appendChild(deleteBtn);
                        actions.appendChild(runBtn);
                        content.appendChild(actions);

                        row.appendChild(content);
                        el.appendChild(row);

                        // 2. Profile Steps
                        const stepsContainer = document.createElement('div');
                        stepsContainer.className = 'profile-steps-container';
                        
                        if (hasProfiles) {
                            workflow.profiles.forEach((profile, pIdx) => {
                                const isLast = pIdx === workflow.profiles.length - 1;
                                const isStepActive = (activeStepId === profile.id);
                                
                                // Container for the step
                                const stepDiv = document.createElement('div');
                                stepDiv.className = 'profile-step';
                                
                                // The Row (Flex Container)
                                const stepRow = document.createElement('div');
                                stepRow.className = 'profile-row';
                                if (isStepActive) stepRow.classList.add('is-active');
                                
                                // 1. Rail (Dot + Line)
                                const stepRail = document.createElement('div');
                                stepRail.className = 'graph-rail';
                                stepRail.style.color = color;
                                
                                const sSvg = document.createElementNS(svgNs, "svg");
                                sSvg.setAttribute("width", "30");
                                sSvg.setAttribute("height", "22");
                                sSvg.setAttribute("viewBox", "0 0 30 22");
                                
                                const sLine = document.createElementNS(svgNs, "line");
                                sLine.setAttribute("x1", "15");
                                sLine.setAttribute("y1", "0");
                                sLine.setAttribute("x2", "15");
                                sLine.setAttribute("y2", isLast ? "11" : "22");
                                sLine.setAttribute("stroke", color);
                                sLine.setAttribute("stroke-width", "2");
                                sSvg.appendChild(sLine);
                                
                                const sCircle = document.createElementNS(svgNs, "circle");
                                sCircle.setAttribute("cx", "15");
                                sCircle.setAttribute("cy", "11");
                                
                                // Active: Larger Dot (+1px radius), Normal: 3.5
                                const pRadius = isStepActive ? "4.5" : "3.5";
                                sCircle.setAttribute("r", pRadius); 
                                
                                sCircle.setAttribute("fill", color); 
                                // No stroke change on active, just fill color remains
                                sCircle.setAttribute("stroke", "none");
                                
                                sSvg.appendChild(sCircle);
                                stepRail.appendChild(sSvg);
                                stepRow.appendChild(stepRail);
                                
                                // 2. Name
                                const stepName = document.createElement('span');
                                stepName.className = 'profile-name';
                                if (profile.isMissing) stepName.classList.add('is-missing');
                                stepName.innerText = profile.name;
                                stepName.style.fontSize = '12px';
                                stepName.style.marginLeft = '4px'; // Spacing from rail
                                stepRow.appendChild(stepName);

                                // 3. Actions (Right Aligned)
                                const stepActions = document.createElement('div');
                                stepActions.className = 'actions';
                                
                                const upBtn = createBtn('arrow-up', 'Move Up');
                                upBtn.onclick = (e) => { e.stopPropagation(); post('moveStepUp', { id: workflow.id, stepId: profile.id }); };
                                
                                const downBtn = createBtn('arrow-down', 'Move Down');
                                downBtn.onclick = (e) => { e.stopPropagation(); post('moveStepDown', { id: workflow.id, stepId: profile.id }); };
                                
                                const removeBtn = createBtn('trash', 'Remove Profile');
                                removeBtn.onclick = (e) => { e.stopPropagation(); post('removeStep', { id: workflow.id, stepId: profile.id, name: profile.name }); };

                                stepActions.appendChild(upBtn);
                                stepActions.appendChild(downBtn);
                                stepActions.appendChild(removeBtn);
                                
                                stepRow.appendChild(stepActions);
                                stepDiv.appendChild(stepRow);
                                
                                stepRow.onclick = (e) => {
                                    e.stopPropagation();
                                    post('openProfile', { id: workflow.id, stepId: profile.id, name: profile.name });
                                };

                                stepsContainer.appendChild(stepDiv);
                            });
                        }
                        
                        el.appendChild(stepsContainer);
                        container.appendChild(el);
                    });
                }
                
                function createBtn(iconName, title) {
                    const btn = document.createElement('button');
                    btn.className = 'icon-btn';
                    btn.title = title;
                    btn.innerHTML = icons[iconName] || '?';
                    return btn;
                }

                // Focus Handling
                window.addEventListener('focus', () => {
                    document.body.classList.add('is-focused');
                });
                window.addEventListener('blur', () => {
                    document.body.classList.remove('is-focused');
                });
                // Initialize state
                if (document.hasFocus()) {
                    document.body.classList.add('is-focused');
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'update':
                            workflows = message.workflows;
                            activeId = message.activeId;
                            activeStepId = message.activeStepId;
                            render();
                            break;
                    }
                });

                render();
            </script>
        </body>
        </html>`;
    }
}
