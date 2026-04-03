import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface CreateProfileInput {
    name: string;
}

/** Saves the current filter configuration as a new named profile. */
export class CreateProfileTool implements vscode.LanguageModelTool<CreateProfileInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CreateProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Creating profile "${options.input.name}" from current filters`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<CreateProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { name } = options.input;

        // Check if name already exists
        const existingNames = this.filterManager.getProfileNames();
        if (existingNames.includes(name)) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Profile "${name}" already exists.`)
            ]);
        }

        const success = await this.filterManager.createProfile(name);
        if (!success) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to create profile "${name}".`)
            ]);
        }

        const groups = this.filterManager.getGroups();
        const wordCount = groups.filter(g => !g.isRegex).length;
        const regexCount = groups.filter(g => g.isRegex).length;
        const totalFilters = groups.reduce((sum, g) => sum + g.filters.length, 0);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Profile "${name}" created with ${wordCount} word group(s), ${regexCount} regex group(s), ${totalFilters} total filter(s).`
            )
        ]);
    }
}
