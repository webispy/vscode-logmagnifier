import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

/** Returns all saved filter profiles with metadata. */
export class ListProfilesTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly filterManager: FilterManager) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const activeProfile = this.filterManager.getActiveProfile();
        const metadata = this.filterManager.getProfilesMetadata();

        const result = {
            activeProfile,
            profiles: metadata.map(p => ({
                name: p.name,
                isActive: p.name === activeProfile,
                textGroupCount: p.textGroupCount,
                regexGroupCount: p.regexGroupCount,
            })),
        };

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
        ]);
    }
}
