import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface SetCaseSensitivityInput {
    groupName: string;
    keyword: string;
    enable: boolean;
}

/** Sets case sensitivity for a filter. */
export class SetCaseSensitivityTool implements vscode.LanguageModelTool<SetCaseSensitivityInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SetCaseSensitivityInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { keyword, enable } = options.input;
        const state = enable ? 'case-sensitive' : 'case-insensitive';
        return {
            invocationMessage: `Setting filter "${keyword}" to ${state}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SetCaseSensitivityInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, keyword, enable } = options.input;

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

        this.filterManager.setFilterCaseSensitivity(group.id, filter.id, enable);
        const state = enable ? 'case-sensitive' : 'case-insensitive';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Filter "${keyword}" is now ${state}.`)
        ]);
    }
}
