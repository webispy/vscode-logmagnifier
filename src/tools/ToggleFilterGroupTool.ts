import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface ToggleFilterGroupInput {
    groupName: string;
}

/** Toggles a filter group's enabled/disabled state. */
export class ToggleFilterGroupTool implements vscode.LanguageModelTool<ToggleFilterGroupInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ToggleFilterGroupInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Toggling filter group "${options.input.groupName}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToggleFilterGroupInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName } = options.input;

        const group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
            ]);
        }

        this.filterManager.toggleGroup(group.id);
        const newState = group.isEnabled ? 'enabled' : 'disabled';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Group "${groupName}" is now ${newState}.`)
        ]);
    }
}
