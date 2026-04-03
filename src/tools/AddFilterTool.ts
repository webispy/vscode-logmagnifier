import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface AddFilterInput {
    keyword: string;
    groupName?: string;
    type?: 'include' | 'exclude';
    isRegex?: boolean;
    caseSensitive?: boolean;
}

/** Adds a filter to a group, creating the group if needed. */
export class AddFilterTool implements vscode.LanguageModelTool<AddFilterInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<AddFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { keyword, type, groupName } = options.input;
        return {
            invocationMessage: `Adding ${type ?? 'include'} filter "${keyword}" to group "${groupName ?? 'AI Filters'}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<AddFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { keyword, isRegex, caseSensitive } = options.input;
        const groupName = options.input.groupName ?? 'AI Filters';
        const type = options.input.type ?? 'include';

        // Find or create group
        let group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            group = this.filterManager.addGroup(groupName, isRegex ?? false);
            if (!group) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Failed to create group "${groupName}".`)
                ]);
            }
        }

        // Add filter
        const filter = this.filterManager.addFilter(group.id, keyword, type, isRegex);
        if (!filter) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to add filter "${keyword}" to group "${groupName}".`)
            ]);
        }

        // Set case sensitivity if specified
        if (caseSensitive) {
            this.filterManager.setFilterCaseSensitivity(group.id, filter.id, true);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Added ${type} filter "${keyword}" to group "${groupName}". Highlighting is now active in the editor.`
            )
        ]);
    }
}
