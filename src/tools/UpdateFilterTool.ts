import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface UpdateFilterInput {
    groupName: string;
    pattern: string;
    newPattern?: string;
    nickname?: string;
}

/** Updates a filter's pattern or nickname. */
export class UpdateFilterTool implements vscode.LanguageModelTool<UpdateFilterInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { pattern, newPattern, nickname } = options.input;
        const changes: string[] = [];
        if (newPattern) { changes.push(`pattern → "${newPattern}"`); }
        if (nickname !== undefined) { changes.push(`nickname → "${nickname}"`); }
        return {
            invocationMessage: `Updating filter "${pattern}": ${changes.join(', ')}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<UpdateFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, pattern, newPattern, nickname } = options.input;

        if (!newPattern && nickname === undefined) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No updates specified. Provide newPattern and/or nickname.')
            ]);
        }

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

        const updates: { pattern?: string; nickname?: string } = {};
        if (newPattern) { updates.pattern = newPattern; }
        if (nickname !== undefined) { updates.nickname = nickname; }

        this.filterManager.updateFilter(group.id, filter.id, updates);

        const changes: string[] = [];
        if (newPattern) { changes.push(`pattern → "${newPattern}"`); }
        if (nickname !== undefined) { changes.push(`nickname → "${nickname}"`); }
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Updated filter: ${changes.join(', ')}.`)
        ]);
    }
}
