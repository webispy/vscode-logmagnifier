import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface ToggleFilterInput {
    groupName: string;
    keyword: string;
}

/** Toggles a filter item's enabled/disabled state. */
export class ToggleFilterTool implements vscode.LanguageModelTool<ToggleFilterInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ToggleFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { groupName, keyword } = options.input;
        return {
            invocationMessage: `Toggling filter "${keyword}" in group "${groupName}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToggleFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, keyword } = options.input;

        const group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
            ]);
        }

        const filter = group.filters.find(f => f.keyword === keyword);
        if (!filter) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Filter "${keyword}" not found in group "${groupName}".`)
            ]);
        }

        this.filterManager.toggleFilter(group.id, filter.id);
        const newState = filter.isEnabled ? 'enabled' : 'disabled';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Filter "${keyword}" is now ${newState}.`)
        ]);
    }
}
