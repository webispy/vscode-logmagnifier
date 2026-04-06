import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface CreateProfileInput {
    name: string;
    copyFrom?: string;
}

/** Creates a new filter profile with flexible source options. */
export class CreateProfileTool implements vscode.LanguageModelTool<CreateProfileInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CreateProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { name, copyFrom } = options.input;
        const source = copyFrom === 'current'
            ? ' from current filters'
            : copyFrom
                ? ` from profile "${copyFrom}"`
                : ' (empty)';
        return {
            invocationMessage: `Creating profile "${name}"${source}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<CreateProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { name, copyFrom } = options.input;

        // Check if name already exists
        const existingNames = this.filterManager.getProfileNames();
        if (existingNames.includes(name)) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Profile "${name}" already exists.`)
            ]);
        }

        let success: boolean;

        if (!copyFrom) {
            // No source: create empty profile
            success = await this.filterManager.createEmptyProfile(name);
        } else if (copyFrom === 'current') {
            // Snapshot current active filters
            success = await this.filterManager.duplicateProfile(name);
            if (success) {
                await this.filterManager.loadProfile(name);
            }
        } else {
            // Copy from a specific profile
            if (!existingNames.includes(copyFrom)) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Source profile "${copyFrom}" not found. Available profiles: ${existingNames.join(', ')}`
                    )
                ]);
            }
            success = await this.filterManager.createProfileFrom(name, copyFrom);
        }

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
