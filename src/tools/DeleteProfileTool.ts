import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface DeleteProfileInput {
    name: string;
}

/** Deletes a filter profile by name. Cannot delete the Default profile. */
export class DeleteProfileTool implements vscode.LanguageModelTool<DeleteProfileInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<DeleteProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Deleting profile "${options.input.name}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<DeleteProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { name } = options.input;

        // Verify profile exists
        const profileNames = this.filterManager.getProfileNames();
        if (!profileNames.includes(name)) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Profile "${name}" not found. Available profiles: ${profileNames.join(', ')}`
                )
            ]);
        }

        const success = await this.filterManager.deleteProfile(name);
        if (!success) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Cannot delete profile "${name}". The Default profile cannot be deleted.`
                )
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Profile "${name}" deleted.`)
        ]);
    }
}
