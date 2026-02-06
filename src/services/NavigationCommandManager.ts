
import * as vscode from 'vscode';

import { Constants } from '../constants';
import { FileHierarchyService } from '../services/FileHierarchyService';
import { Logger } from '../services/Logger';

export class NavigationCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private hierarchyService: FileHierarchyService
    ) {
        this.registerCommands();
    }

    private registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.HierarchyOpenParent, (uri: vscode.Uri) => {
            this.openFile(uri);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.HierarchyOpenOriginal, (uri: vscode.Uri) => {
            this.openFile(uri);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.HierarchyShowQuickPick, (uri: vscode.Uri, _mode: 'siblings' | 'children' | 'tree' = 'tree') => {
            this.showQuickPick(uri, _mode);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.HierarchyShowFullTree, () => {
            if (vscode.window.activeTextEditor) {
                this.showQuickPick(vscode.window.activeTextEditor.document.uri, 'tree');
            }
        }));
    }

    private async openFile(uri: vscode.Uri) {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (e) {
            Logger.getInstance().error(`Failed to open file ${uri.toString()}: ${e}`);
            vscode.window.showErrorMessage(`Failed to open file: ${e}`);
        }
    }

    private async showQuickPick(currentUri: vscode.Uri, _mode: 'siblings' | 'children' | 'tree') {
        const root = this.hierarchyService.getRoot(currentUri) || currentUri;
        const items: vscode.QuickPickItem[] = [];

        // Recursive function to build tree
        const buildTree = (uri: vscode.Uri, depth: number) => {
            const node = this.hierarchyService.getNode(uri);
            if (!node) { return; }

            const isCurrent = uri.toString() === currentUri.toString();

            // Indentation
            const indent = '\u00A0\u00A0\u00A0'.repeat(depth);
            let icon = '$(file)';
            if (node.type === 'original') { icon = '$(home)'; }
            else if (node.type === 'bookmark') { icon = '$(bookmark)'; }
            else if (node.type === 'filter') { icon = '$(filter)'; }

            const label = `${indent}${icon} ${node.label}`;

            const item: vscode.QuickPickItem = {
                label: label,
                description: isCurrent ? '(Current)' : '',
                detail: uri.scheme === 'file' ? uri.fsPath : uri.toString(),
                picked: isCurrent
            };

            items.push(item);

            const children = this.hierarchyService.getChildren(uri);
            // Sort children
            children.sort((a, b) => {
                const nodeA = this.hierarchyService.getNode(a);
                const nodeB = this.hierarchyService.getNode(b);
                return (nodeA?.label || '').localeCompare(nodeB?.label || '');
            });

            for (const child of children) {
                buildTree(child, depth + 1);
            }
        };

        buildTree(root, 0);

        if (items.length === 0) {
            vscode.window.showInformationMessage('No hierarchy found.');
            return;
        }

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'Navigate File Hierarchy',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selection && selection.detail) {
            let targetUri: vscode.Uri | undefined;

            if (selection.detail.startsWith('Untitled:') || selection.detail.startsWith('untitled:')) {
                targetUri = vscode.Uri.parse(selection.detail);
            } else {
                targetUri = vscode.Uri.file(selection.detail);
            }

            if (targetUri) {
                this.openFile(targetUri);
            }
        }
    }
}
