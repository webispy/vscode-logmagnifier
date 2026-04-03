import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface SetContextLineInput {
    groupName: string;
    keyword: string;
    lines: number;
}

/** Sets the number of context lines (before/after match) for a filter. */
export class SetContextLineTool implements vscode.LanguageModelTool<SetContextLineInput> {
    private static readonly VALID_LEVELS = [0, 3, 5, 9];

    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SetContextLineInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { keyword, lines } = options.input;
        return {
            invocationMessage: `Setting context lines to ±${lines} for filter "${keyword}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SetContextLineInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, keyword, lines } = options.input;

        if (!SetContextLineTool.VALID_LEVELS.includes(lines)) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Invalid context line value: ${lines}. Must be one of: ${SetContextLineTool.VALID_LEVELS.join(', ')}.`
                )
            ]);
        }

        const group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
            ]);
        }

        const filter = group.filters.find(f => f.keyword === keyword);
        if (!filter) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Filter "${keyword}" not found in group "${groupName}".`)
            ]);
        }

        this.filterManager.setFilterContextLine(group.id, filter.id, lines);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                lines === 0
                    ? `Context lines disabled for filter "${keyword}".`
                    : `Context lines set to ±${lines} for filter "${keyword}".`
            )
        ]);
    }
}
