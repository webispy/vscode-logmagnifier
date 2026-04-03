import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface UpdateFilterInput {
    groupName: string;
    keyword: string;
    newKeyword?: string;
    nickname?: string;
}

/** Updates a filter's keyword or nickname. */
export class UpdateFilterTool implements vscode.LanguageModelTool<UpdateFilterInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { keyword, newKeyword, nickname } = options.input;
        const changes: string[] = [];
        if (newKeyword) { changes.push(`keyword → "${newKeyword}"`); }
        if (nickname !== undefined) { changes.push(`nickname → "${nickname}"`); }
        return {
            invocationMessage: `Updating filter "${keyword}": ${changes.join(', ')}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<UpdateFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, keyword, newKeyword, nickname } = options.input;

        if (!newKeyword && nickname === undefined) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No updates specified. Provide newKeyword and/or nickname.')
            ]);
        }

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

        const updates: { keyword?: string; nickname?: string } = {};
        if (newKeyword) { updates.keyword = newKeyword; }
        if (nickname !== undefined) { updates.nickname = nickname; }

        this.filterManager.updateFilter(group.id, filter.id, updates);

        const changes: string[] = [];
        if (newKeyword) { changes.push(`keyword → "${newKeyword}"`); }
        if (nickname !== undefined) { changes.push(`nickname → "${nickname}"`); }
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Updated filter: ${changes.join(', ')}.`)
        ]);
    }
}
