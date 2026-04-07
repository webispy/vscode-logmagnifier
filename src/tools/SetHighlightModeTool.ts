import * as vscode from 'vscode';

import { HighlightMode } from '../models/Filter';
import { FilterManager } from '../services/FilterManager';

interface SetHighlightModeInput {
    groupName: string;
    pattern: string;
    mode: 'word' | 'line' | 'fullLine';
}

const MODE_MAP: Record<string, HighlightMode> = {
    word: HighlightMode.Word,
    line: HighlightMode.Line,
    fullLine: HighlightMode.FullLine,
};

/** Sets the highlight mode (word, line, or full line) for a filter. */
export class SetHighlightModeTool implements vscode.LanguageModelTool<SetHighlightModeInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SetHighlightModeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { pattern, mode } = options.input;
        return {
            invocationMessage: `Setting highlight mode to "${mode}" for filter "${pattern}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SetHighlightModeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, pattern, mode } = options.input;

        const highlightMode = MODE_MAP[mode];
        if (highlightMode === undefined) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Invalid highlight mode: "${mode}". Must be one of: word, line, fullLine.`
                )
            ]);
        }

        const group = this.filterManager.getGroups().find(g => g.name === groupName);
        if (!group) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
            ]);
        }

        const filter = group.filters.find(f => f.pattern === pattern);
        if (!filter) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Filter "${pattern}" not found in group "${groupName}".`)
            ]);
        }

        this.filterManager.setFilterHighlightMode(group.id, filter.id, highlightMode);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Highlight mode for filter "${pattern}" set to "${mode}".`)
        ]);
    }
}
