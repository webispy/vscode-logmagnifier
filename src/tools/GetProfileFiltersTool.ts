import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface GetProfileFiltersInput {
    profileName: string;
    enabledOnly?: boolean;
}

/** Returns the filter groups and items for a specific profile without switching to it. */
export class GetProfileFiltersTool implements vscode.LanguageModelTool<GetProfileFiltersInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GetProfileFiltersInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { profileName, enabledOnly } = options.input;

        // Verify profile exists
        const profileNames = this.filterManager.getProfileNames();
        if (!profileNames.includes(profileName)) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Profile "${profileName}" not found. Available profiles: ${profileNames.join(', ')}`
                )
            ]);
        }

        const groups = await this.filterManager.getProfileGroups(profileName);
        if (!groups || groups.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Profile "${profileName}" has no filter groups.`)
            ]);
        }

        const filtered = enabledOnly ? groups.filter(g => g.isEnabled) : groups;

        const summary = filtered.map(g => ({
            name: g.name,
            isEnabled: g.isEnabled,
            isRegex: g.isRegex ?? false,
            filterCount: g.filters.length,
            filters: g.filters.map(f => ({
                pattern: f.pattern,
                type: f.type,
                isEnabled: f.isEnabled,
                caseSensitive: f.caseSensitive ?? false,
            })),
        }));

        if (summary.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Profile "${profileName}" has no ${enabledOnly ? 'enabled ' : ''}filter groups.`)
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(summary, null, 2))
        ]);
    }
}
