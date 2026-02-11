import * as vscode from 'vscode';
import { WorkflowManager, WorkflowViewModel } from '../services/WorkflowManager';
import { escapeHtml } from '../utils/WebviewUtils';

export class SidebarWorkflowWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'logmagnifier-workflow';
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];

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

        try {
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
                    -webkit-user-select: none;
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

                /* CUSTOM CONTEXT MENU */
                #custom-context-menu {
                    position: fixed;
                    z-index: 10000;
                    background-color: var(--vscode-menu-background);
                    color: var(--vscode-menu-foreground);
                    border: 1px solid var(--vscode-menu-border);
                    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                    padding: 4px 0;
                    min-width: 160px;
                    border-radius: 5px;
                    display: none;
                    user-select: none;
                    -webkit-user-select: none;
                }
                #custom-context-menu.visible {
                    display: block;
                }
                .menu-item {
                    padding: 4px 12px;
                    cursor: pointer;
                    font-size: 13px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .menu-item:hover {
                    background-color: var(--vscode-menu-selectionBackground);
                    color: var(--vscode-menu-selectionForeground);
                }
                .menu-separator {
                    height: 1px;
                    background-color: var(--vscode-menu-separatorBackground);
                    margin: 4px 0;
                }
            </style>
        </head>
        <body>
            <div id="graph-container"></div>
            
            <div id="custom-context-menu">
                <div class="menu-item" id="menu-rename">Rename...</div>
                <div class="menu-separator"></div>
                <div class="menu-item" id="menu-open-all">Open All Results</div>
                <div class="menu-item" id="menu-close-all">Close All Results</div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const container = document.getElementById('graph-container');
                let workflows = ${JSON.stringify(workflows).replace(/</g, '\\u003c')};
                let activeId = ${JSON.stringify(activeId || '')}.replace(/</g, '\\u003c');
                let activeStepId = ${JSON.stringify(this._workflowManager.getActiveStep() || '')}.replace(/</g, '\\u003c');
                const colors = ${JSON.stringify(graphColors).replace(/</g, '\\u003c')};

                // Icons (VS Code Codicons)
                const icons = {
                    'search': '<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 6V11C15 13.21 13.21 15 11 15H6C5.26 15 4.62 14.6 4.27 14H11C12.65 14 14 12.65 14 11V4.27C14.6 4.62 15 5.26 15 6ZM11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13ZM4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12ZM9.5 7H8V5.5C8 5.224 7.776 5 7.5 5C7.224 5 7 5.224 7 5.5V7H5.5C5.224 7 5 7.224 5 7.5C5 7.776 5.224 8 5.5 8H7V9.5C7 9.776 7.224 10 7.5 10C7.776 10 8 9.776 8 9.5V8H9.5C9.776 8 10 7.776 10 7.5C10 7.224 9.776 7 9.5 7Z"/></svg>', // expand-all
                    'close-all': '<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M13.5004 12.0004C13.7762 12.0006 14.0004 12.2245 14.0004 12.5004C14.0002 12.7761 13.7761 13.0002 13.5004 13.0004H2.50037C2.22449 13.0004 2.00056 12.7762 2.00037 12.5004C2.00037 12.2244 2.22437 12.0004 2.50037 12.0004H13.5004Z"/><path d="M13.5004 9.00037C13.7762 9.00056 14.0004 9.22449 14.0004 9.50037C14.0002 9.77608 13.7761 10.0002 13.5004 10.0004H2.50037C2.22449 10.0004 2.00056 9.7762 2.00037 9.50037C2.00037 9.22437 2.22437 9.00037 2.50037 9.00037H13.5004Z"/><path d="M13.5004 6.00037C13.7762 6.00056 14.0004 6.22449 14.0004 6.50037C14.0002 6.77608 13.7761 7.00017 13.5004 7.00037H7.50037C7.22449 7.00037 7.00056 6.7762 7.00037 6.50037C7.00037 6.22437 7.22437 6.00037 7.50037 6.00037H13.5004Z"/><path d="M5.50037 0.999023C5.63295 0.999115 5.76009 1.05179 5.85388 1.14551C5.94777 1.23939 6.00037 1.36722 6.00037 1.5C6.00027 1.63265 5.94769 1.75971 5.85388 1.85352L3.7074 4L5.85388 6.14551C5.94777 6.23939 6.00037 6.36722 6.00037 6.5C6.00027 6.63265 5.94769 6.75971 5.85388 6.85352C5.76008 6.94732 5.63302 6.99991 5.50037 7C5.36759 7 5.23976 6.9474 5.14587 6.85352L3.00037 4.70703L0.853882 6.85352C0.760077 6.94732 0.633017 6.99991 0.500366 7C0.36759 7 0.239761 6.9474 0.145874 6.85352C0.0521583 6.75972 -0.000519052 6.63258 -0.000610352 6.5C-0.000610354 6.36722 0.0519875 6.23939 0.145874 6.14551L2.29333 4L0.145874 1.85352C0.0521583 1.75972 -0.000519119 1.63258 -0.000610352 1.5C-0.000610351 1.36722 0.0519874 1.23939 0.145874 1.14551C0.239761 1.05162 0.36759 0.999023 0.500366 0.999023C0.63295 0.999115 0.76009 1.05179 0.853882 1.14551L3.00037 3.29297L5.14587 1.14551C5.23976 1.05162 5.36759 0.999023 5.50037 0.999023Z"/><path d="M13.5004 3.00037C13.7762 3.00056 14.0004 3.22449 14.0004 3.50037C14.0002 3.77608 13.7761 4.00017 13.5004 4.00037H7.50037C7.22449 4.00037 7.00056 3.7762 7.00037 3.50037C7.00037 3.22437 7.22437 3.00037 7.50037 3.00037H13.5004Z"/></svg>', // clear-all
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

                let contextWorkflowId = null;
                let contextWorkflowName = null;

                function render() {
                    container.innerHTML = '';
                    if (workflows.length === 0) {
                        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">No workflows created.<br>Click "+" in the menu or use Command Palette to create one.</div>';
                        return;
                    }
                    workflows.forEach((workflow, index) => {
                        const color = colors[index % colors.length];
                        const isWorkflowActive = (activeId === workflow.id && !activeStepId);
                        const isExpanded = workflow.isExpanded; 
                        const hasProfiles = workflow.profiles && workflow.profiles.length > 0;
                        
                        const el = document.createElement('div');
                        el.className = 'workflow-node ' + (isExpanded ? 'expanded' : '');
                        
                        const row = document.createElement('div');
                        row.className = 'node-row';
                        if (isWorkflowActive) row.classList.add('is-active');
                        
                        row.onclick = () => post('clickWorkflow', { id: workflow.id });
                        
                        row.oncontextmenu = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showContextMenu(e.clientX, e.clientY, workflow.id, workflow.name);
                        };
                        
                        const rail = document.createElement('div');
                        rail.className = 'graph-rail';
                        rail.style.color = color;
                        rail.appendChild(createRailSvg(color, {
                            hasTopLine: false,
                            hasBottomLine: isExpanded && hasProfiles,
                            circleRadius: 4.5,
                            isStroked: true,
                            isActive: isWorkflowActive
                        }));
                        row.appendChild(rail);
                        
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
                        actions.appendChild(createBtn('add', 'Add Profile')).onclick = (e) => { e.stopPropagation(); post('addStep', { id: workflow.id }); };
                        actions.appendChild(createBtn('trash', 'Delete Workflow')).onclick = (e) => { e.stopPropagation(); post('delete', { id: workflow.id, name: workflow.name }); };
                        actions.appendChild(createBtn('play', 'Run Workflow')).onclick = (e) => { e.stopPropagation(); post('run', { id: workflow.id }); };
                        
                        content.appendChild(actions);
                        row.appendChild(content);
                        el.appendChild(row);

                        const stepsContainer = document.createElement('div');
                        stepsContainer.className = 'profile-steps-container';
                        
                        if (hasProfiles) {
                            workflow.profiles.forEach((profile, pIdx) => {
                                const isLast = pIdx === workflow.profiles.length - 1;
                                const isStepActive = (activeStepId === profile.id);
                                const stepDiv = document.createElement('div');
                                stepDiv.className = 'profile-step';
                                const stepRow = document.createElement('div');
                                stepRow.className = 'profile-row';
                                if (isStepActive) stepRow.classList.add('is-active');
                                
                                const stepRail = document.createElement('div');
                                stepRail.className = 'graph-rail';
                                stepRail.style.color = color;
                                stepRail.appendChild(createRailSvg(color, {
                                    hasTopLine: true,
                                    hasBottomLine: !isLast,
                                    circleRadius: isStepActive ? 4.5 : 3.5,
                                    isStroked: false,
                                    isActive: isStepActive
                                }));
                                stepRow.appendChild(stepRail);
                                
                                const stepName = document.createElement('span');
                                stepName.className = 'profile-name';
                                if (profile.isMissing) stepName.classList.add('is-missing');
                                stepName.innerText = profile.name;
                                stepRow.appendChild(stepName);
                                
                                const stepActions = document.createElement('div');
                                stepActions.className = 'actions';
                                stepActions.appendChild(createBtn('arrow-up', 'Move Up')).onclick = (e) => { e.stopPropagation(); post('moveStepUp', { id: workflow.id, stepId: profile.id }); };
                                stepActions.appendChild(createBtn('arrow-down', 'Move Down')).onclick = (e) => { e.stopPropagation(); post('moveStepDown', { id: workflow.id, stepId: profile.id }); };
                                stepActions.appendChild(createBtn('trash', 'Remove Profile')).onclick = (e) => { e.stopPropagation(); post('removeStep', { id: workflow.id, stepId: profile.id, name: profile.name }); };
                                
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

                function showContextMenu(x, y, id, name) {
                    contextWorkflowId = id;
                    contextWorkflowName = name;
                    const menu = document.getElementById('custom-context-menu');
                    menu.style.left = x + 'px';
                    menu.style.top = y + 'px';
                    menu.classList.add('visible');
                    const rect = menu.getBoundingClientRect();
                    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
                    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
                }

                function hideContextMenu() {
                    const menu = document.getElementById('custom-context-menu');
                    menu.classList.remove('visible');
                    contextWorkflowId = null;
                    contextWorkflowName = null;
                }

                document.getElementById('menu-rename').onclick = () => {
                    if (contextWorkflowId) post('renameWorkflow', { id: contextWorkflowId, currentName: contextWorkflowName });
                    hideContextMenu();
                };
                document.getElementById('menu-open-all').onclick = () => {
                    if (contextWorkflowId) post('openAllResults', { id: contextWorkflowId });
                    hideContextMenu();
                };
                document.getElementById('menu-close-all').onclick = () => {
                    if (contextWorkflowId) post('closeAllResults', { id: contextWorkflowId });
                    hideContextMenu();
                };

                window.addEventListener('click', () => hideContextMenu());
                window.addEventListener('contextmenu', (e) => { if (!e.target.closest('.node-row')) hideContextMenu(); });
                window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
                function createRailSvg(color, options) {
                    const { hasTopLine, hasBottomLine, circleRadius, isStroked, isActive } = options;
                    const svgNs = "http://www.w3.org/2000/svg";
                    const svg = document.createElementNS(svgNs, "svg");
                    if (hasTopLine) {
                        const line = document.createElementNS(svgNs, "line");
                        line.setAttribute("x1", "15"); line.setAttribute("y1", "0");
                        line.setAttribute("x2", "15"); line.setAttribute("y2", "11");
                        line.setAttribute("stroke", color); line.setAttribute("stroke-width", "2");
                        svg.appendChild(line);
                    }
                    if (hasBottomLine) {
                        const line = document.createElementNS(svgNs, "line");
                        line.setAttribute("x1", "15"); line.setAttribute("y1", "11");
                        line.setAttribute("x2", "15"); line.setAttribute("y2", "22");
                        line.setAttribute("stroke", color); line.setAttribute("stroke-width", "2");
                        svg.appendChild(line);
                    }
                    const circle = document.createElementNS(svgNs, "circle");
                    circle.setAttribute("cx", "15"); circle.setAttribute("cy", "11");
                    circle.setAttribute("r", circleRadius);
                    if (isStroked) {
                        circle.setAttribute("fill", "var(--vscode-sideBar-background)");
                        circle.setAttribute("stroke", color);
                        circle.setAttribute("stroke-width", isActive ? "3" : "2");
                    } else {
                        circle.setAttribute("fill", color);
                    }
                    svg.appendChild(circle);
                    svg.setAttribute("width", "30"); svg.setAttribute("height", "22"); svg.setAttribute("viewBox", "0 0 30 22");
                    return svg;
                }

                function createBtn(iconName, title) {
                    const btn = document.createElement('button');
                    btn.className = 'icon-btn';
                    btn.title = title;
                    btn.innerHTML = icons[iconName] || '?';
                    return btn;
                }

                // Focus Handling
                window.addEventListener('focus', () => document.body.classList.add('is-focused'));
                window.addEventListener('blur', () => document.body.classList.remove('is-focused'));
                if (document.hasFocus()) document.body.classList.add('is-focused');

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
