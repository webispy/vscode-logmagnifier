import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface SwitchProfileInput {
    name: string;
}

/** Switches the active filter profile. */
export class SwitchProfileTool implements vscode.LanguageModelTool<SwitchProfileInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SwitchProfileInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Switching to profile "${options.input.name}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SwitchProfileInput>,
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

        const success = await this.filterManager.loadProfile(name);
        if (!success) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to switch to profile "${name}".`)
            ]);
        }

        const groups = this.filterManager.getGroups();
        const textCount = groups.filter(g => !g.isRegex).length;
        const regexCount = groups.filter(g => g.isRegex).length;

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Switched to profile "${name}" (${textCount} text group(s), ${regexCount} regex group(s)). Editor highlights updated.`
            )
        ]);
    }
}
