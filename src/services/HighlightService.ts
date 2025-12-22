import * as vscode from 'vscode';
import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';

export class HighlightService {
    // Map of color string -> DecorationType
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

    constructor(private filterManager: FilterManager) {
        // Initial setup if needed
    }

    private getDecorationType(colorNameOrValue: string): vscode.TextEditorDecorationType {
        if (!this.decorationTypes.has(colorNameOrValue)) {
            const preset = this.filterManager.getPresetByName(colorNameOrValue);

            let decorationOptions: vscode.DecorationRenderOptions;

            if (preset) {
                decorationOptions = {
                    light: {
                        backgroundColor: preset.light
                    },
                    dark: {
                        backgroundColor: preset.dark
                    },
                    color: 'inherit',
                    fontWeight: 'bold'
                };
            } else {
                // Fallback for backward compatibility or if it's a raw color value
                decorationOptions = {
                    backgroundColor: colorNameOrValue,
                    color: 'inherit',
                    fontWeight: 'bold'
                };
            }

            const decoration = vscode.window.createTextEditorDecorationType(decorationOptions);
            this.decorationTypes.set(colorNameOrValue, decoration);
        }
        return this.decorationTypes.get(colorNameOrValue)!;
    }

    public refreshDecorationType() {
        this.dispose();
        this.decorationTypes.clear();
    }

    public updateHighlights(editor: vscode.TextEditor) {
        if (!editor) {
            return;
        }

        const activeGroups = this.filterManager.getGroups().filter(g => g.isEnabled);
        const includeFilters: FilterItem[] = [];

        activeGroups.forEach(g => {
            g.filters.forEach(f => {
                if (f.type === 'include' && f.isEnabled && !f.isRegex) {
                    includeFilters.push(f);
                }
            });
        });

        // Clear all existing decorations first? 
        // Actually, we should clear decorations for colors that are no longer in use,
        // or just re-set all known decorations.
        // A simple strategy is to clear all *current* decorations on the editor by setting them to empty ranges,
        // but since we manage a map, we can just iterate over our map and set ranges.

        if (includeFilters.length === 0) {
            this.decorationTypes.forEach(dt => editor.setDecorations(dt, []));
            return;
        }

        const text = editor.document.getText();

        // Group ranges by color
        const rangesByColor: Map<string, vscode.Range[]> = new Map();

        // Initialize ranges for all currently known decoration types to empty to clear old highlights
        // This is important if a filter was removed or disabled.
        this.decorationTypes.forEach((_, color) => rangesByColor.set(color, []));

        // Default highlight color from config if filter has no specific color (backward compatibility)
        const defaultColor = vscode.workspace.getConfiguration('loglens').get<string>('highlightColor') || 'rgba(255, 255, 0, 0.3)';

        includeFilters.forEach(filter => {
            if (!filter.keyword) {
                return;
            }

            const color = filter.color || defaultColor;
            if (!rangesByColor.has(color)) {
                rangesByColor.set(color, []);
            }

            // Ensure we have a decoration type for this color
            this.getDecorationType(color);

            let match;
            let regex: RegExp;

            try {
                if (filter.isRegex) {
                    // Should not happen here based on logic above, but good for safety
                    regex = new RegExp(filter.keyword, 'gi');
                } else {
                    const escapedKeyword = filter.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const flags = filter.caseSensitive ? 'g' : 'gi';
                    regex = new RegExp(escapedKeyword, flags);
                }

                while ((match = regex.exec(text))) {
                    const startPos = editor.document.positionAt(match.index);
                    const endPos = editor.document.positionAt(match.index + match[0].length);

                    if (filter.enableFullLineHighlight) {
                        const line = editor.document.lineAt(startPos.line);
                        rangesByColor.get(color)!.push(line.rangeIncludingLineBreak);
                    } else {
                        rangesByColor.get(color)!.push(new vscode.Range(startPos, endPos));
                    }
                }
            } catch (e) {
                // Ignore
            }
        });

        // Apply decorations
        rangesByColor.forEach((ranges, color) => {
            const decorationType = this.getDecorationType(color);
            editor.setDecorations(decorationType, ranges);
        });
    }

    public dispose() {
        this.decorationTypes.forEach(dt => dt.dispose());
        this.decorationTypes.clear();
    }
}
