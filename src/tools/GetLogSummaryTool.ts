import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';
import { TimestampService } from '../services/TimestampService';

/** Returns summary information about the active log file. */
export class GetLogSummaryTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(
        private readonly filterManager: FilterManager,
        private readonly timestampService: TimestampService
    ) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const doc = editor.document;
        const lineCount = doc.lineCount;
        const text = doc.getText();
        const sizeBytes = Buffer.byteLength(text, 'utf-8');
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);

        const summary: Record<string, unknown> = {
            fileName: doc.fileName,
            lineCount,
            fileSize: `${sizeMB} MB`,
            languageId: doc.languageId,
        };

        // Timestamp info
        const uri = doc.uri.toString();
        const index = this.timestampService.getIndex(uri);
        if (index) {
            summary.timestamp = {
                format: index.format.name,
                firstTime: index.firstTime.toISOString(),
                lastTime: index.lastTime.toISOString(),
                linesWithTimestamps: index.lineTimestamps.size,
            };
        }

        // Active filters
        const activeFilters = this.filterManager.getActiveFilters();
        const groups = this.filterManager.getGroups();
        summary.activeProfile = this.filterManager.getActiveProfile();
        summary.filterGroups = groups.length;
        summary.activeFilters = activeFilters.length;

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(summary, null, 2))
        ]);
    }
}
