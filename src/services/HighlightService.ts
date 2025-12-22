import * as vscode from 'vscode';
import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';

export class HighlightService {
    private decorationType: vscode.TextEditorDecorationType;

    constructor(private filterManager: FilterManager) {
        this.decorationType = this.createDecorationType();
    }

    private createDecorationType(): vscode.TextEditorDecorationType {
        const color = vscode.workspace.getConfiguration('loglens').get<string>('highlightColor') || 'rgba(255, 255, 0, 0.3)';
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: color,
            color: 'inherit',
            fontWeight: 'bold'
        });
    }

    public refreshDecorationType() {
        this.decorationType.dispose();
        this.decorationType = this.createDecorationType();
    }

    public updateHighlights(editor: vscode.TextEditor) {
        if (!editor) return;

        const activeGroups = this.filterManager.getGroups().filter(g => g.isEnabled);
        const includeKeywords: string[] = [];

        activeGroups.forEach(g => {
            g.filters.forEach(f => {
                if (f.type === 'include' && f.isEnabled) {
                    includeKeywords.push(f.keyword);
                }
            });
        });

        if (includeKeywords.length === 0) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const text = editor.document.getText();
        const ranges: vscode.Range[] = [];

        includeKeywords.forEach(keyword => {
            if (!keyword) {
                return;
            }
            let match;
            // Simple string search or regex. Keyword might need escaping if used in regex.
            // Using simple indexOf loop for safety, or regex with escaping.
            // Let's use Regex to find all occurrences globally.
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedKeyword, 'gi');

            while ((match = regex.exec(text))) {
                const startPos = editor.document.positionAt(match.index);
                const endPos = editor.document.positionAt(match.index + match[0].length);
                ranges.push(new vscode.Range(startPos, endPos));
            }
        });

        editor.setDecorations(this.decorationType, ranges);
    }

    public dispose() {
        this.decorationType.dispose();
    }
}
