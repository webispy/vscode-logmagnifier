import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';

interface UpdateFilterColorInput {
    groupName: string;
    keyword: string;
    color: string;
}

const VALID_COLORS = [
    'color00', 'color01', 'color02', 'color03', 'color04',
    'color05', 'color06', 'color07', 'color08', 'color09',
    'color10', 'color11', 'color12', 'color13', 'color14',
    'color15', 'color16',
];

const COLOR_NAMES: Record<string, string> = {
    color00: 'none (bold only)',
    color01: 'yellow',
    color02: 'orange',
    color03: 'red',
    color04: 'magenta',
    color05: 'violet',
    color06: 'blue',
    color07: 'cyan',
    color08: 'green',
    color09: 'light yellow',
    color10: 'light orange',
    color11: 'light red',
    color12: 'light magenta',
    color13: 'light violet',
    color14: 'light blue',
    color15: 'light cyan',
    color16: 'light green',
};

/** Changes the highlight color of a filter. */
export class UpdateFilterColorTool implements vscode.LanguageModelTool<UpdateFilterColorInput> {
    constructor(private readonly filterManager: FilterManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateFilterColorInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { keyword, color } = options.input;
        const name = COLOR_NAMES[color] ?? color;
        return {
            invocationMessage: `Changing filter "${keyword}" color to ${name}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<UpdateFilterColorInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { groupName, keyword, color } = options.input;

        if (!VALID_COLORS.includes(color)) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Invalid color: "${color}". Valid colors: ${VALID_COLORS.map(c => `${c} (${COLOR_NAMES[c]})`).join(', ')}`
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

        this.filterManager.updateFilterColor(group.id, filter.id, color);
        const name = COLOR_NAMES[color] ?? color;
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Filter "${keyword}" color changed to ${name} (${color}).`)
        ]);
    }
}
