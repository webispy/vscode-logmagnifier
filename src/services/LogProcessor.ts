import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import { FilterGroup, FilterItem } from '../models/Filter';

export class LogProcessor {
    /**
     * Processes a log file and returns filtered lines.
     * @param inputPath Path to the input log file.
     * @param filterGroups Active filter groups to apply.
     * @returns A promise that resolves to the output path and statistics.
     */
    public async processFile(inputPath: string, filterGroups: FilterGroup[], options?: { prependLineNumbers?: boolean, totalLineCount?: number }): Promise<{ outputPath: string, processed: number, matched: number }> {
        const fileStream = fs.createReadStream(inputPath, { encoding: 'utf8' });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        const activeGroups = filterGroups.filter(g => g.isEnabled);

        // Path and stream setup
        const os = require('os');
        const path = require('path');
        const tmpDir = os.tmpdir();
        const prefix = vscode.workspace.getConfiguration('logmagnifier').get<string>('tempFilePrefix') || 'filtered_';
        const now = new Date();
        const outputFilename = `${prefix}${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.log`;
        const outputPath = path.join(tmpDir, outputFilename);
        const outputStream = fs.createWriteStream(outputPath);

        let processed = 0;
        let matched = 0;

        const maxBeforeLines = 10;
        const beforeBuffer: { line: string, index: number }[] = [];
        let afterLinesRemaining = 0;
        let lastWrittenLineIndex = -1; // Index of the last line written to output

        // Padding calculation
        const prependLineNumbers = options?.prependLineNumbers || false;
        const totalLineCount = options?.totalLineCount || 999999;
        const padding = totalLineCount.toString().length;

        const formatLine = (line: string, index: number) => {
            if (prependLineNumbers) {
                return `${index.toString().padStart(padding, '0')}: ${line}`;
            }
            return line;
        };

        try {
            for await (const line of rl) {
                processed++;
                const matchResult = this.checkMatch(line, activeGroups);

                if (matchResult.isMatched) {
                    matched++;

                    // 1. Write 'Before' context lines that haven't been written yet
                    const contextBefore = matchResult.contextLines;
                    const startIndex = Math.max(0, beforeBuffer.length - contextBefore);
                    const linesToSubmit = beforeBuffer.slice(startIndex);

                    for (let i = 0; i < linesToSubmit.length; i++) {
                        const bufferedItem = linesToSubmit[i];
                        if (bufferedItem.index > lastWrittenLineIndex) {
                            if (!outputStream.write(formatLine(bufferedItem.line, bufferedItem.index) + '\n')) {
                                await new Promise<void>(resolve => outputStream.once('drain', () => resolve()));
                            }
                            lastWrittenLineIndex = bufferedItem.index;
                        }
                    }

                    // 2. Write current matching line
                    if (processed > lastWrittenLineIndex) {
                        if (!outputStream.write(formatLine(line, processed) + '\n')) {
                            await new Promise<void>(resolve => outputStream.once('drain', () => resolve()));
                        }
                        lastWrittenLineIndex = processed;
                    }

                    // 3. Set/Update 'After' context counter
                    afterLinesRemaining = Math.max(afterLinesRemaining, matchResult.contextLines);
                } else if (afterLinesRemaining > 0) {
                    // This is an 'After' context line
                    if (processed > lastWrittenLineIndex) {
                        if (!outputStream.write(formatLine(line, processed) + '\n')) {
                            await new Promise<void>(resolve => outputStream.once('drain', () => resolve()));
                        }
                        lastWrittenLineIndex = processed;
                    }
                    afterLinesRemaining--;
                }

                // Maintain before buffer
                beforeBuffer.push({ line, index: processed });
                if (beforeBuffer.length > maxBeforeLines) {
                    beforeBuffer.shift();
                }
            }
        } finally {
            outputStream.end();
            await new Promise<void>(resolve => outputStream.on('finish', () => resolve()));
        }

        return { outputPath, processed, matched };
    }

    /**
     * Checks if a line matches filters and returns the required context lines.
     */
    public checkMatch(line: string, groups: FilterGroup[]): { isMatched: boolean, contextLines: number } {
        let maxContext = 0;
        let isMatched = true;

        if (groups.length === 0) { return { isMatched: false, contextLines: 0 }; }

        for (const group of groups) {
            const includes = group.filters.filter(f => f.type === 'include' && f.isEnabled);
            const excludes = group.filters.filter(f => f.type === 'exclude' && f.isEnabled);

            // Excludes
            for (const exclude of excludes) {
                if (this.lineMatchesFilter(line, exclude)) {
                    return { isMatched: false, contextLines: 0 };
                }
            }

            // Includes
            if (includes.length > 0) {
                let groupMatch = false;
                let groupMaxContext = 0;
                for (const include of includes) {
                    if (this.lineMatchesFilter(line, include)) {
                        groupMatch = true;
                        groupMaxContext = Math.max(groupMaxContext, include.contextLine ?? 0);
                    }
                }
                if (!groupMatch) {
                    return { isMatched: false, contextLines: 0 };
                }
                maxContext = Math.max(maxContext, groupMaxContext);
            }
        }

        return { isMatched, contextLines: maxContext };
    }

    private lineMatchesFilter(line: string, filter: FilterItem): boolean {
        if (filter.isRegex) {
            try {
                const flags = filter.caseSensitive ? '' : 'i';
                const regex = new RegExp(filter.keyword, flags);
                return regex.test(line);
            } catch (e) { return false; }
        } else {
            if (filter.caseSensitive) {
                return line.includes(filter.keyword);
            } else {
                return line.toLowerCase().includes(filter.keyword.toLowerCase());
            }
        }
    }
}
