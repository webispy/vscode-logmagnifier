import * as vscode from 'vscode';

import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';
import { Logger } from './Logger';

export class HighlightService {
    // Map of color string -> DecorationType
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

    constructor(
        private filterManager: FilterManager,
        private logger: Logger
    ) {
        // Initial setup if needed
    }

    private getDecorationType(colorNameOrValue: string | { light: string, dark: string }, isFullLine: boolean = false): vscode.TextEditorDecorationType {
        const key = `${typeof colorNameOrValue === 'string' ? colorNameOrValue : JSON.stringify(colorNameOrValue)}_${isFullLine}`;
        if (!this.decorationTypes.has(key)) {
            let decorationOptions: vscode.DecorationRenderOptions;

            if (typeof colorNameOrValue === 'string') {
                const preset = this.filterManager.getPresetById(colorNameOrValue);
                if (preset) {
                    decorationOptions = {
                        light: {
                            backgroundColor: preset.light
                        },
                        dark: {
                            backgroundColor: preset.dark
                        },
                        fontWeight: 'bold',
                        isWholeLine: isFullLine
                    };
                } else {
                    // Fallback for custom color string
                    decorationOptions = {
                        backgroundColor: colorNameOrValue,
                        fontWeight: 'bold',
                        isWholeLine: isFullLine
                    };
                }
            } else {
                // Object with light/dark values
                decorationOptions = {
                    light: {
                        backgroundColor: colorNameOrValue.light
                    },
                    dark: {
                        backgroundColor: colorNameOrValue.dark
                    },
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

        const enableRegexHighlight = vscode.workspace.getConfiguration('logmagnifier').get<boolean>('enableRegexHighlight') || false;

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

        this.logger.info(`Highlighting started (Items: ${includeFilters.length})`);
        const startTime = Date.now();

        const text = editor.document.getText();

        // Group ranges by decoration type key (color + fullLine)
        const rangesByDeco: Map<string, vscode.Range[]> = new Map();

        // Initialize ranges for all currently known decoration types to empty to clear old highlights
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        // Default highlight color from config if filter has no specific color (backward compatibility)
        const defaultColor = vscode.workspace.getConfiguration('logmagnifier').get<string | { light: string, dark: string }>('regexHighlightColor') || 'rgba(255, 255, 0, 0.3)';

        includeFilters.forEach(filter => {
            if (!filter.keyword) {
                return;
            }

            const color = filter.color || defaultColor;
            const mode = filter.highlightMode ?? 0;
            const isFullLine = mode === 2;
            const decoKey = `${typeof color === 'string' ? color : JSON.stringify(color)}_${isFullLine}`;

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
            const separatorIndex = decoKey.lastIndexOf('_');
            const colorStr = decoKey.substring(0, separatorIndex);
            const isFullLineStr = decoKey.substring(separatorIndex + 1);

            let color: string | { light: string, dark: string };
            try {
                // If it starts with {, assume it's a JSON object
                if (colorStr.startsWith('{')) {
                    color = JSON.parse(colorStr);
                } else {
                    color = colorStr;
                }
            } catch (e) {
                color = colorStr;
            }

            const isFullLine = isFullLineStr === 'true';

            // Deduplicate ranges to avoid opacity stacking
            // For full line/line mode, we only need one range per line
            let uniqueRanges: vscode.Range[] = [];
            if (isFullLine) { // This covers mode 2 (Full Line) which sets isFullLine=true in decoration
                const lines = new Set<number>();
                uniqueRanges = ranges.filter(r => {
                    if (lines.has(r.start.line)) {
                        return false;
                    }
                    lines.add(r.start.line);
                    return true;
                });
            } else {
                // For word mode or line mode, we dedup by exact range equality.
                // Since mode 1 pushes the same line range multiple times, this handles it correctly.

                const seen = new Set<string>();
                uniqueRanges = ranges.filter(r => {
                    const key = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            }

            const decorationType = this.getDecorationType(color, isFullLine);
            editor.setDecorations(decorationType, uniqueRanges);
        });

        const duration = Date.now() - startTime;
        this.logger.info(`Highlighting finished (${duration}ms)`);
    }

    public dispose() {
        this.decorationTypes.forEach(dt => dt.dispose());
        this.decorationTypes.clear();
    }
}
