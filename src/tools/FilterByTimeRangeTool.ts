import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { Logger } from '../services/Logger';
import { SourceMapService } from '../services/SourceMapService';
import { TimestampService } from '../services/TimestampService';

interface FilterByTimeRangeInput {
    startTime?: string;
    endTime?: string;
}

/** Filters the active log file by time range. */
export class FilterByTimeRangeTool implements vscode.LanguageModelTool<FilterByTimeRangeInput> {
    constructor(
        private readonly timestampService: TimestampService,
        private readonly sourceMapService: SourceMapService,
        private readonly logger: Logger
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<FilterByTimeRangeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { startTime, endTime } = options.input;
        const rangeStr = `${startTime ?? 'start'} ~ ${endTime ?? 'end'}`;
        return {
            invocationMessage: `Filtering log by time range: ${rangeStr}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<FilterByTimeRangeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const doc = editor.document;
        const uri = doc.uri.toString();
        const index = this.timestampService.getIndex(uri);

        if (!index) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No timestamps detected in the active file. Time range filtering requires a log file with recognizable timestamps.')
            ]);
        }

        const { startTime: startStr, endTime: endStr } = options.input;

        // Parse time inputs
        const baseTime = index.firstTime;
        const startTime = startStr
            ? this.timestampService.parseTimeInput(startStr, baseTime)
            : undefined;
        const endTime = endStr
            ? this.timestampService.parseTimeInput(endStr, baseTime)
            : undefined;

        if (startStr && !startTime) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Could not parse start time: "${startStr}"`)
            ]);
        }
        if (endStr && !endTime) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Could not parse end time: "${endStr}"`)
            ]);
        }

        // Get all lines
        const lines: string[] = [];
        for (let i = 0; i < doc.lineCount; i++) {
            lines.push(doc.lineAt(i).text);
        }

        const result = this.timestampService.filterLinesByTimeRange(
            lines, index.format, startTime, endTime
        );

        if (result.filteredLines.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No lines found in the specified time range.')
            ]);
        }

        try {
            // Write filtered output to temp file
            const tmpFile = path.join(os.tmpdir(), `LM_timerange_${Date.now()}.log`);
            fs.writeFileSync(tmpFile, result.filteredLines.join('\n'), 'utf-8');

            // Register source map
            const outputUri = vscode.Uri.file(tmpFile);
            this.sourceMapService.register(outputUri, doc.uri, result.lineMapping);

            // Open filtered document
            const newDoc = await vscode.workspace.openTextDocument(tmpFile);
            await vscode.window.showTextDocument(newDoc, { preview: false });
            if (newDoc.languageId !== 'log') {
                try {
                    await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
                } catch (e: unknown) {
                    this.logger.info(`[FilterByTimeRangeTool] Set language failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            const rangeStr = `${startStr ?? 'start'} ~ ${endStr ?? 'end'}`;
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Time range filter applied (${rangeStr}). Filtered: ${result.filteredLines.length} / ${lines.length} lines.`
                )
            ]);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[FilterByTimeRangeTool] Failed: ${msg}`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to filter by time range: ${msg}`)
            ]);
        }
    }
}
