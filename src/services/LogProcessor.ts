import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import { FilterGroup, FilterItem } from '../models/Filter';
import { RegexUtils } from '../utils/RegexUtils';


export interface CompiledGroup {
    includes: { regex: RegExp, contextLine: number }[];
    excludes: RegExp[];
}

export class LogProcessor {

    public compileGroups(activeGroups: FilterGroup[]): CompiledGroup[] {
        return activeGroups.map(group => ({
            includes: group.filters
                .filter(f => f.type === 'include' && f.isEnabled)
                .map(f => ({
                    regex: RegexUtils.create(f.keyword, !!f.isRegex, !!f.caseSensitive),
                    contextLine: f.contextLine ?? 0
                })),
            excludes: group.filters
                .filter(f => f.type === 'exclude' && f.isEnabled)
                .map(f => RegexUtils.create(f.keyword, !!f.isRegex, !!f.caseSensitive))
        }));
    }

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
        const compiledGroups = this.compileGroups(activeGroups);

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

                const matchResult = this.checkMatchCompiled(line, compiledGroups);

                if (matchResult.isMatched) {
                    matched++;
                    const maxContext = matchResult.contextLines;

                    // 1. Write 'Before' context lines that haven't been written yet
                    const startIndex = Math.max(0, beforeBuffer.length - maxContext);
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
                    afterLinesRemaining = Math.max(afterLinesRemaining, maxContext);
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
     * Checks if a line matches filters using pre-compiled regex groups.
     */
    public checkMatchCompiled(line: string, compiledGroups: CompiledGroup[]): { isMatched: boolean, contextLines: number } {
        let maxContext = 0;
        let isMatched = true;

        if (compiledGroups.length === 0) {
            return { isMatched: false, contextLines: 0 };
        }

        for (const group of compiledGroups) {
            // Excludes
            let isExcluded = false;
            for (const excludeRegex of group.excludes) {
                if (excludeRegex.test(line)) {
                    isExcluded = true;
                    break;
                }
            }
            if (isExcluded) {
                isMatched = false;
                break;
            }

            // Includes
            if (group.includes.length > 0) {
                let groupMatch = false;
                let groupMaxContext = 0;
                for (const include of group.includes) {
                    if (include.regex.test(line)) {
                        groupMatch = true;
                        groupMaxContext = Math.max(groupMaxContext, include.contextLine);
                    }
                }
                if (!groupMatch) {
                    isMatched = false;
                    break;
                }
                maxContext = Math.max(maxContext, groupMaxContext);
            }
        }

        return { isMatched, contextLines: maxContext };
    }

    /**
     * Checks if a line matches filters and returns the required context lines.
     * Legacy method: Wrapper around checkMatchCompiled for backward compatibility.
     */
    public checkMatch(line: string, groups: FilterGroup[]): { isMatched: boolean, contextLines: number } {
        // Optimization: if we are calling this in a loop for many lines, it's better to use checkMatchCompiled
        // with pre-compiled groups.
        const activeGroups = groups.filter(g => g.isEnabled);
        const compiled = this.compileGroups(activeGroups);
        return this.checkMatchCompiled(line, compiled);
    }

}
