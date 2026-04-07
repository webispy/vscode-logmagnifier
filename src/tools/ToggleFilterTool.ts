import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface ToggleFilterInput {
    groupName: string;
    pattern: string;
}

/** Toggles a filter item's enabled/disabled state. */
export class ToggleFilterTool implements vscode.LanguageModelTool<ToggleFilterInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ToggleFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { groupName, pattern } = options.input;
        return {
            invocationMessage: `Toggling filter "${pattern}" in group "${groupName}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToggleFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, pattern } = options.input;

        const group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
            ]);
        }

        const filter = group.filters.find(f => f.pattern === pattern);
        if (!filter) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Filter "${pattern}" not found in group "${groupName}".`)
            ]);
        }

        this.filterManager.toggleFilter(group.id, filter.id);
        const newState = filter.isEnabled ? 'enabled' : 'disabled';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Filter "${pattern}" is now ${newState}.`)
        ]);
    }
}
