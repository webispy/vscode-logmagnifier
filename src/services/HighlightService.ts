import * as vscode from 'vscode';
import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';

export class HighlightService {
    // Map of color string -> DecorationType
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

    constructor(private filterManager: FilterManager) {
        // Initial setup if needed
    }

    private getDecorationType(colorNameOrValue: string, isFullLine: boolean = false): vscode.TextEditorDecorationType {
        const key = `${colorNameOrValue}_${isFullLine}`;
        if (!this.decorationTypes.has(key)) {
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
                    fontWeight: 'bold',
                    isWholeLine: isFullLine
                };
            } else {
                // Fallback for backward compatibility or if it's a raw color value
                decorationOptions = {
                    backgroundColor: colorNameOrValue,
                    color: 'inherit',
                    fontWeight: 'bold',
                    isWholeLine: isFullLine
                };
            }

            const decoration = vscode.window.createTextEditorDecorationType(decorationOptions);
            this.decorationTypes.set(key, decoration);
        }
        return this.decorationTypes.get(key)!;
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

        const enableRegexHighlight = vscode.workspace.getConfiguration('loglens').get<boolean>('enableRegexHighlight') || false;

        activeGroups.forEach(g => {
            g.filters.forEach(f => {
                if (f.type === 'include' && f.isEnabled) {
                    if (f.isRegex && !enableRegexHighlight) {
                        return;
                    }
                    includeFilters.push(f);
                }
            });
        });

        if (includeFilters.length === 0) {
            this.decorationTypes.forEach(dt => editor.setDecorations(dt, []));
            return;
        }

        const text = editor.document.getText();

        // Group ranges by decoration type key (color + fullLine)
        const rangesByDeco: Map<string, vscode.Range[]> = new Map();

        // Initialize ranges for all currently known decoration types to empty to clear old highlights
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        // Default highlight color from config if filter has no specific color (backward compatibility)
        const defaultColor = vscode.workspace.getConfiguration('loglens').get<string>('highlightColor') || 'rgba(255, 255, 0, 0.3)';

        includeFilters.forEach(filter => {
            if (!filter.keyword) {
                return;
            }

            const color = filter.color || defaultColor;
            const mode = filter.highlightMode ?? 0;
            const isFullLine = mode === 2;
            const decoKey = `${color}_${isFullLine}`;

            if (!rangesByDeco.has(decoKey)) {
                rangesByDeco.set(decoKey, []);
            }

            // Ensure we have a decoration type for this combo
            this.getDecorationType(color, isFullLine);

            let match;
            let regex: RegExp;

            try {
                if (filter.isRegex) {
                    regex = new RegExp(filter.keyword, 'gi');
                } else {
                    const escapedKeyword = filter.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const flags = filter.caseSensitive ? 'g' : 'gi';
                    regex = new RegExp(escapedKeyword, flags);
                }

                while ((match = regex.exec(text))) {
                    const startPos = editor.document.positionAt(match.index);
                    const endPos = editor.document.positionAt(match.index + match[0].length);

                    if (mode === 1 || mode === 2) {
                        const line = editor.document.lineAt(startPos.line);
                        // For mode 1 (Line) or mode 2 (Full Line), we use the line range.
                        // The difference is in the DecorationType's isFullLine property.
                        rangesByDeco.get(decoKey)!.push(line.range);
                    } else {
                        // mode 0: Word
                        rangesByDeco.get(decoKey)!.push(new vscode.Range(startPos, endPos));
                    }
                }
            } catch (e) {
                // Ignore
            }
        });

        // Apply decorations
        rangesByDeco.forEach((ranges, decoKey) => {
            const [color, isFullLineStr] = decoKey.split('_');
            const isFullLine = isFullLineStr === 'true';
            const decorationType = this.getDecorationType(color, isFullLine);
            editor.setDecorations(decorationType, ranges);
        });
    }

    public dispose() {
        this.decorationTypes.forEach(dt => dt.dispose());
        this.decorationTypes.clear();
    }
}
