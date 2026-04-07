import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface RemoveFilterInput {
    groupName: string;
    pattern?: string;
}

/** Removes a filter item or an entire filter group. */
export class RemoveFilterTool implements vscode.LanguageModelTool<RemoveFilterInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RemoveFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { groupName, pattern } = options.input;
        const msg = pattern
            ? `Removing filter "${pattern}" from group "${groupName}"`
            : `Removing entire group "${groupName}"`;
        return { invocationMessage: msg };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RemoveFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, pattern } = options.input;

        const group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
            ]);
        }

        if (pattern) {
            const filter = group.filters.find(f => f.pattern === pattern);
            if (!filter) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Filter "${pattern}" not found in group "${groupName}".`)
                ]);
            }
            this.filterManager.removeFilter(group.id, filter.id);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Removed filter "${pattern}" from group "${groupName}".`)
            ]);
        }

        this.filterManager.removeGroup(group.id);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Removed group "${groupName}" and all its filters.`)
        ]);
    }
}
