
import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FileHierarchyService } from '../services/FileHierarchyService';
import { Logger } from '../services/Logger';

interface HierarchyQuickPickItem extends vscode.QuickPickItem {
    _uri: vscode.Uri;
    _type: 'original' | 'filter' | 'bookmark';
}

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
            vscode.window.showErrorMessage(Constants.Messages.Error.OpenFileFailed.replace('{0}', String(e)));
        }
    }

    private async showQuickPick(currentUri: vscode.Uri, _mode: 'siblings' | 'children' | 'tree') {
        const picker = vscode.window.createQuickPick<HierarchyQuickPickItem>();
        picker.placeholder = 'Navigate File Hierarchy';
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;

        const updateItems = () => {
            const root = this.hierarchyService.getRoot(currentUri) || currentUri;
            const items: HierarchyQuickPickItem[] = [];

            // Recursive function to build tree
            const buildTree = (uri: vscode.Uri, depth: number) => {
                const node = this.hierarchyService.getNode(uri);
                if (!node) { return; }

                const isCurrent = uri.toString() === currentUri.toString();

                // Indentation
                // Use figure space for better alignment in Quick Pick
                const indent = '\u2007\u2007'.repeat(depth);
                let icon = '$(file)';
                if (node.type === 'original') { icon = '$(home)'; }
                else if (node.type === 'bookmark') { icon = '$(bookmark)'; }
                else if (node.type === 'filter') { icon = '$(filter)'; }

                const label = `${indent}${icon} ${node.label}`;

                const item: HierarchyQuickPickItem = {
                    label: label,
                    description: isCurrent ? '(Current)' : '',
                    detail: uri.scheme === 'file' ? uri.fsPath : uri.toString(),
                    picked: isCurrent,
                    buttons: [
                        {
                            iconPath: new vscode.ThemeIcon('trash'),
                            tooltip: node.type === 'original' ? 'Delete this and all children' : 'Delete this item'
                        }
                    ],
                    _uri: uri,
                    _type: node.type
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
                picker.dispose();
                vscode.window.showInformationMessage('No hierarchy found.');
                return;
            }

            picker.items = items;
        };

        updateItems();

        picker.onDidTriggerItemButton(e => {
            const item = e.item;
            const uri = item._uri;
            const type = item._type;

            if (uri) {
                const isRecursive = type === 'original';
                this.hierarchyService.unregister(uri, isRecursive);
                updateItems();
            }
        });

        picker.onDidAccept(() => {
            const selection = picker.selectedItems[0];
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
            picker.dispose();
        });

        picker.onDidHide(() => {
            picker.dispose();
        });

        picker.show();
    }
}
