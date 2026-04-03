import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { Logger } from '../services/Logger';
import { SourceMapService } from '../services/SourceMapService';
import { TimestampService } from '../services/TimestampService';

interface ExtractLogsWithMarginInput {
    time: string;
    marginSeconds: number;
}

/** Extracts log lines around a center time with a ± margin in seconds. */
export class ExtractLogsWithMarginTool implements vscode.LanguageModelTool<ExtractLogsWithMarginInput> {
    constructor(
        private readonly timestampService: TimestampService,
        private readonly sourceMapService: SourceMapService,
        private readonly logger: Logger
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ExtractLogsWithMarginInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { time, marginSeconds } = options.input;
        return {
            invocationMessage: `Extracting logs around ${time} ± ${marginSeconds}s`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ExtractLogsWithMarginInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const doc = editor.document;
        const index = this.timestampService.getIndex(doc.uri.toString());

        if (!index) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No timestamps detected in the active file.')
            ]);
        }

        const { time: timeStr, marginSeconds } = options.input;

        if (marginSeconds < 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('marginSeconds must be a non-negative number.')
            ]);
        }

        const cursorLine = editor.selection.active.line;
        const cursorEntry = index.lineTimestamps.get(cursorLine);
        const cursorTime = cursorEntry ?? index.firstTime;

        const centerTime = this.timestampService.parseTimeInput(timeStr, index.firstTime, cursorTime);
        if (!centerTime) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Could not parse time: "${timeStr}"`)
            ]);
        }

        const marginMs = marginSeconds * 1000;
        const startTime = new Date(centerTime.getTime() - marginMs);
        const endTime = new Date(centerTime.getTime() + marginMs);

        const lines: string[] = [];
        for (let i = 0; i < doc.lineCount; i++) {
            lines.push(doc.lineAt(i).text);
        }

        const result = this.timestampService.filterLinesByTimeRange(
            lines, index.format, startTime, endTime
        );

        if (result.filteredLines.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`No lines found around ${timeStr} ± ${marginSeconds}s.`)
            ]);
        }

        try {
            const tmpFile = path.join(os.tmpdir(), `LM_margin_${Date.now()}.log`);
            fs.writeFileSync(tmpFile, result.filteredLines.join('\n'), 'utf-8');

            const outputUri = vscode.Uri.file(tmpFile);
            this.sourceMapService.register(outputUri, doc.uri, result.lineMapping);

            const newDoc = await vscode.workspace.openTextDocument(tmpFile);
            await vscode.window.showTextDocument(newDoc, { preview: false });
            if (newDoc.languageId !== 'log') {
                try {
                    await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
                } catch (e: unknown) {
                    this.logger.info(`[ExtractLogsWithMarginTool] Set language failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Extracted logs around ${timeStr} ± ${marginSeconds}s. Result: ${result.filteredLines.length} / ${lines.length} lines.`
                )
            ]);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[ExtractLogsWithMarginTool] Failed: ${msg}`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to extract logs: ${msg}`)
            ]);
        }
    }
}
