import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface GetFiltersInput {
    enabledOnly?: boolean;
}

/** Returns all filter groups and their items. */
export class GetFiltersTool implements vscode.LanguageModelTool<GetFiltersInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GetFiltersInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const enabledOnly = options.input.enabledOnly ?? false;
        const groups = this.filterManager.getGroups();
        const filtered = enabledOnly ? groups.filter(g => g.isEnabled) : groups;

        const summary = filtered.map(g => ({
            name: g.name,
            isEnabled: g.isEnabled,
            isRegex: g.isRegex ?? false,
            filterCount: g.filters.length,
            resultCount: g.resultCount ?? 0,
            filters: g.filters.map(f => ({
                keyword: f.keyword,
                type: f.type,
                isEnabled: f.isEnabled,
                caseSensitive: f.caseSensitive ?? false,
                resultCount: f.resultCount ?? 0,
            })),
        }));

        if (summary.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No filters configured.')
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(summary, null, 2))
        ]);
    }
}
