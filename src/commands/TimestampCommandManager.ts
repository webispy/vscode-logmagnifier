import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { Constants } from '../Constants';

import { FileHierarchyService } from '../services/FileHierarchyService';
import { HighlightService } from '../services/HighlightService';
import { Logger } from '../services/Logger';
import { SourceMapService } from '../services/SourceMapService';
import { TimestampService } from '../services/TimestampService';
import { TimeRangeTreeDataProvider, TimeRangeTreeItem } from '../views/TimeRangeTreeDataProvider';

export class TimestampCommandManager {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly timestampService: TimestampService,
        private readonly sourceMapService: SourceMapService,
        private readonly highlightService: HighlightService,
        private readonly timeRangeProvider: TimeRangeTreeDataProvider,
        private readonly logger: Logger,
    ) {
        this.registerCommands();
    }

    private registerCommands(): void {
        // Tree context menu commands
        this.context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.Commands.TimeRangeInclude,
                (item: TimeRangeTreeItem) => this.includeRange(item),
            ),
            vscode.commands.registerCommand(
                Constants.Commands.TimeRangeIncludeWithMargin,
                (item: TimeRangeTreeItem) => this.includeRangeWithMargin(item),
            ),
            vscode.commands.registerCommand(
                Constants.Commands.TimeRangeTrimBefore,
                (item: TimeRangeTreeItem) => this.trimBefore(item),
            ),
            vscode.commands.registerCommand(
                Constants.Commands.TimeRangeTrimAfter,
                (item: TimeRangeTreeItem) => this.trimAfter(item),
            ),
            // Editor context menu commands
            vscode.commands.registerCommand(
                Constants.Commands.TimeRangeTrimBeforeLine,
                () => this.trimBeforeLine(),
            ),
            vscode.commands.registerCommand(
                Constants.Commands.TimeRangeTrimAfterLine,
                () => this.trimAfterLine(),
            ),
            // Go to Timestamp
            vscode.commands.registerCommand(
                Constants.Commands.TimestampGotoTime,
                () => this.gotoTime(),
            ),
        );
    }

    private async includeRange(item: TimeRangeTreeItem): Promise<void> {
        if (!item) {
            return;
        }
        await this.executeTimeFilter(item.node.startTime, item.node.endTime);
    }

    private async includeRangeWithMargin(item: TimeRangeTreeItem): Promise<void> {
        if (!item) {
            return;
        }
        const input = await vscode.window.showInputBox({
            prompt: 'Time margin in seconds (applied before and after)',
            value: '30',
            validateInput: (v) => {
                const n = Number(v);
                if (isNaN(n) || n < 0) {
                    return 'Enter a non-negative number';
                }
                return undefined;
            },
        });
        if (input === undefined) {
            return;
        }
        const marginMs = Number(input) * 1000;
        const startTime = new Date(item.node.startTime.getTime() - marginMs);
        const endTime = new Date(item.node.endTime.getTime() + marginMs);
        await this.executeTimeFilter(startTime, endTime);
    }

    private async trimBefore(item: TimeRangeTreeItem): Promise<void> {
        if (!item) {
            return;
        }
        await this.executeTimeFilter(item.node.startTime, undefined);
    }

    private async trimAfter(item: TimeRangeTreeItem): Promise<void> {
        if (!item) {
            return;
        }
        await this.executeTimeFilter(undefined, item.node.endTime);
    }

    private async trimBeforeLine(): Promise<void> {
        const lineTime = this.getActiveLineTimestamp();
        if (!lineTime) {
            vscode.window.showWarningMessage('No timestamp found on the current line.');
            return;
        }
        await this.executeTimeFilter(lineTime, undefined);
    }

    private async trimAfterLine(): Promise<void> {
        const lineTime = this.getActiveLineTimestamp();
        if (!lineTime) {
            vscode.window.showWarningMessage('No timestamp found on the current line.');
            return;
        }
        await this.executeTimeFilter(undefined, lineTime);
    }

    private async gotoTime(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const index = this.timeRangeProvider.getIndex();
        if (!index) {
            vscode.window.showWarningMessage('No timestamp index available for this document.');
            return;
        }

        const cursorTime = this.getActiveLineTimestamp();

        const input = await vscode.window.showInputBox({
            prompt: 'Go to timestamp',
            placeHolder: 'e.g. 14:32, 14:32:15, +5m, -30s',
        });
        if (input === undefined) {
            return;
        }

        const targetTime = this.timestampService.parseTimeInput(input, index.firstTime, cursorTime);
        if (!targetTime) {
            vscode.window.showWarningMessage(`Invalid time input: "${input}"`);
            return;
        }

        const line = this.timestampService.findLineByTime(index, targetTime);
        if (line < 0 || line >= editor.document.lineCount) {
            return;
        }

        const range = new vscode.Range(line, 0, line, 0);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(range.start, range.start);
        this.highlightService.flashLine(editor, line);
    }

    /** Parse the timestamp from the active editor's cursor line. */
    private getActiveLineTimestamp(): Date | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const index = this.timeRangeProvider.getIndex();
        if (!index) {
            return undefined;
        }
        const lineText = editor.document.lineAt(editor.selection.active.line).text;
        return this.timestampService.parseLine(lineText, index.format);
    }

    /**
     * Core filter execution: extract lines within the given time range from the
     * active document, write them to a temp file, and open it in a new tab.
     */
    private async executeTimeFilter(startTime?: Date, endTime?: Date): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }

        const index = this.timeRangeProvider.getIndex();
        if (!index) {
            vscode.window.showErrorMessage('No timestamp index available for this document.');
            return;
        }

        const document = editor.document;
        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            lines.push(document.lineAt(i).text);
        }

        const { filteredLines, lineMapping } = this.timestampService.filterLinesByTimeRange(
            lines, index.format, startTime, endTime,
        );

        if (filteredLines.length === 0) {
            vscode.window.showWarningMessage('No lines matched the specified time range.');
            return;
        }

        const outputPath = await this.writeTempFile(filteredLines);

        // Register source map and file hierarchy
        const sourceUri = document.uri;
        const outputUri = vscode.Uri.file(outputPath);
        this.sourceMapService.register(outputUri, sourceUri, lineMapping);
        FileHierarchyService.getInstance().registerChild(sourceUri, outputUri, 'filter');

        // Open the result file
        const newDoc = await vscode.workspace.openTextDocument(outputPath);
        await vscode.window.showTextDocument(newDoc, { preview: false });

        if (newDoc.languageId !== 'log') {
            try {
                await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
            } catch (e: unknown) {
                this.logger.info(`[TimestampCommandManager] Set language failed: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const pad = (n: number) => String(n).padStart(2, '0');
        const rangeDesc = startTime && endTime
            ? `${pad(startTime.getHours())}:${pad(startTime.getMinutes())}~${pad(endTime.getHours())}:${pad(endTime.getMinutes())}`
            : startTime
                ? `from ${pad(startTime.getHours())}:${pad(startTime.getMinutes())}`
                : endTime
                    ? `until ${pad(endTime.getHours())}:${pad(endTime.getMinutes())}`
                    : 'all';

        const timeout = vscode.workspace.getConfiguration(Constants.Configuration.Section)
            .get<number>(Constants.Configuration.StatusBarTimeout) ?? 5000;
        vscode.window.setStatusBarMessage(
            `Time range ${rangeDesc}: ${filteredLines.length.toLocaleString()} of ${lines.length.toLocaleString()} lines`,
            timeout,
        );
    }

    /** Write lines to a temporary .log file following the existing naming pattern. */
    private async writeTempFile(lines: string[]): Promise<string> {
        const tmpDir = os.tmpdir();
        const prefix = vscode.workspace.getConfiguration(Constants.Configuration.Section)
            .get<string>(Constants.Configuration.TempFilePrefix) ?? Constants.Defaults.TempFilePrefix;
        const now = new Date();
        const uniqueSuffix = crypto.randomBytes(4).toString('hex');
        const ts = `${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}_${now.getMilliseconds().toString().padStart(3, '0')}`;
        const outputPath = path.join(tmpDir, `${prefix}${ts}_${uniqueSuffix}.log`);
        await fs.promises.writeFile(outputPath, lines.join('\n') + '\n', 'utf8');
        return outputPath;
    }
}
