
import * as vscode from 'vscode';
import { FileHierarchyService } from '../services/FileHierarchyService';
import { Constants } from '../constants';

export class FileHierarchyLensProvider implements vscode.CodeLensProvider {

    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const uri = document.uri;

        // Only show if the file is tracked in hierarchy or has a parent
        // or check if it is part of the system at all?
        // Let's check if it has a parent or children.
        const parent = this.hierarchyService.getParent(uri);
        const children = this.hierarchyService.getChildren(uri);
        const root = this.hierarchyService.getRoot(uri);

        if (!parent && children.length === 0) {
            return [];
        }

        const range = new vscode.Range(0, 0, 0, 0);

        // 1. Full Tree (Always first)
        lenses.push(new vscode.CodeLens(range, {
            title: `$(list-tree) Full Tree`,
            tooltip: 'Show Full Hierarchy Tree',
            command: Constants.Commands.HierarchyShowQuickPick,
            arguments: [uri, 'tree']
        }));

        // 2. Original & Parent
        // Design: Origin | Parent
        // Special Case: Origin (Parent) if same
        if (root && root.toString() !== uri.toString()) {
            const rootName = this.hierarchyService.getNode(root)?.label || 'Original';
            const isParentOriginal = parent && parent.toString() === root.toString();

            if (isParentOriginal) {
                // Combined: Origin (Parent): Name
                lenses.push(new vscode.CodeLens(range, {
                    title: `$(home) Original (Parent): ${rootName}`,
                    tooltip: `Go to Original: ${rootName}`,
                    command: Constants.Commands.HierarchyOpenOriginal,
                    arguments: [root]
                }));
            } else {
                // Separate: Origin: Name
                lenses.push(new vscode.CodeLens(range, {
                    title: `$(home) Original: ${rootName}`,
                    tooltip: `Go to Original: ${rootName}`,
                    command: Constants.Commands.HierarchyOpenOriginal,
                    arguments: [root]
                }));

                // Parent (if exists and distinct)
                if (parent) {
                    const parentName = this.hierarchyService.getNode(parent)?.label || 'Parent';
                    lenses.push(new vscode.CodeLens(range, {
                        title: `$(arrow-small-up) Parent: ${parentName}`,
                        tooltip: 'Go to Parent File',
                        command: Constants.Commands.HierarchyOpenParent,
                        arguments: [parent]
                    }));
                }
            }
        } else if (parent) {
            // Check if parent is root? (Already handled above indirectly, but if root logic fails)
            const parentName = this.hierarchyService.getNode(parent)?.label || 'Parent';
            lenses.push(new vscode.CodeLens(range, {
                title: `$(arrow-small-up) Parent: ${parentName}`,
                tooltip: 'Go to Parent File',
                command: Constants.Commands.HierarchyOpenParent,
                arguments: [parent]
            }));
        }

        return lenses;
    }

    public onDidChangeCodeLenses?: vscode.Event<void> | undefined;

    constructor(private hierarchyService: FileHierarchyService) {
        this.onDidChangeCodeLenses = this.hierarchyService.onDidChangeHierarchy;
    }
}
