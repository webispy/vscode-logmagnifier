import * as vscode from 'vscode';

import { Constants } from '../Constants';

import { FileHierarchyService } from '../services/FileHierarchyService';

export class FileHierarchyLensProvider implements vscode.CodeLensProvider {
    public onDidChangeCodeLenses?: vscode.Event<void> | undefined;

    constructor(private hierarchyService: FileHierarchyService) {
        this.onDidChangeCodeLenses = this.hierarchyService.onDidChangeHierarchy;
    }

    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const uri = document.uri;

        const parent = this.hierarchyService.getParent(uri);
        const children = this.hierarchyService.getChildren(uri);
        const root = this.hierarchyService.getRoot(uri);

        if (!parent && children.length === 0) {
            return [];
        }

        const range = new vscode.Range(0, 0, 0, 0);

        // Full Tree (Always first)
        lenses.push(new vscode.CodeLens(range, {
            title: `$(list-tree) Full Tree`,
            tooltip: 'Show Full Hierarchy Tree',
            command: Constants.Commands.HierarchyShowQuickPick,
            arguments: [uri, 'tree']
        }));

        // Original & Parent
        // Design: Origin | Parent — combined if same
        if (root && root.toString() !== uri.toString()) {
            const rootName = this.hierarchyService.getNode(root)?.label ?? 'Original';
            const isParentOriginal = parent && parent.toString() === root.toString();

            if (isParentOriginal) {
                lenses.push(new vscode.CodeLens(range, {
                    title: `$(home) Original (Parent): ${rootName}`,
                    tooltip: `Go to Original: ${rootName}`,
                    command: Constants.Commands.HierarchyOpenOriginal,
                    arguments: [root]
                }));
            } else {
                lenses.push(new vscode.CodeLens(range, {
                    title: `$(home) Original: ${rootName}`,
                    tooltip: `Go to Original: ${rootName}`,
                    command: Constants.Commands.HierarchyOpenOriginal,
                    arguments: [root]
                }));

                if (parent) {
                    const parentName = this.hierarchyService.getNode(parent)?.label ?? 'Parent';
                    lenses.push(new vscode.CodeLens(range, {
                        title: `$(arrow-small-up) Parent: ${parentName}`,
                        tooltip: 'Go to Parent File',
                        command: Constants.Commands.HierarchyOpenParent,
                        arguments: [parent]
                    }));
                }
            }
        } else if (parent) {
            const parentName = this.hierarchyService.getNode(parent)?.label ?? 'Parent';
            lenses.push(new vscode.CodeLens(range, {
                title: `$(arrow-small-up) Parent: ${parentName}`,
                tooltip: 'Go to Parent File',
                command: Constants.Commands.HierarchyOpenParent,
                arguments: [parent]
            }));
        }

        return lenses;
    }
}
