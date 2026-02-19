import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import { FilterGroup, FilterItem } from '../models/Filter';
import { FileHierarchyService } from './FileHierarchyService';
import { RegexUtils } from '../utils/RegexUtils';
import { CircularBuffer } from '../utils/CircularBuffer';
import { Constants } from '../Constants';

export interface CompiledGroup {
    includes: { regex: RegExp, contextLine: number }[];
    excludes: RegExp[];
}

const DEFAULT_MAX_BEFORE_LINES = 20; // Maximum supported context lines (9) + safety margin
const DEFAULT_MAX_LINE_COUNT = 999999;

export class LogProcessor {

    public compileGroups(activeGroups: FilterGroup[]): CompiledGroup[] {
        return activeGroups.map(group => {
            // Compile filters for this group.
            // We only consider filters that are explicitly enabled.

            const filters = group.filters;
            const effectiveIncludes: FilterItem[] = [];
            const effectiveExcludes: FilterItem[] = [];

            for (const f of filters) {
                if (f.isEnabled) {
                    if (f.type === 'include') {
                        effectiveIncludes.push(f);
                    } else if (f.type === 'exclude') {
                        effectiveExcludes.push(f);
                    }
                }
            }

            return {
                includes: effectiveIncludes.map(f => ({
                    regex: RegexUtils.create(f.keyword, !!f.isRegex, !!f.caseSensitive),
                    contextLine: f.contextLine ?? 0
                })),
                excludes: effectiveExcludes.map(f => RegexUtils.create(f.keyword, !!f.isRegex, !!f.caseSensitive))
            };
        });
    }

    /**
     * Processes a log file and returns filtered lines.
     *
     * @param inputPath - Absolute path to the input log file
     * @param filterGroups - Array of filter groups to apply
     * @param options - Optional processing options
     * @param options.prependLineNumbers - Whether to prepend original line numbers
     * @param options.totalLineCount - Total number of lines for padding calculation
     * @returns Promise resolving to output path and statistics
     * @throws Error if file cannot be read or written
     */
    public async processFile(inputPath: string, filterGroups: FilterGroup[], options?: { prependLineNumbers?: boolean, totalLineCount?: number, originalPath?: string }): Promise<{ outputPath: string, processed: number, matched: number, lineMapping: number[] }> {
        const fileStream = fs.createReadStream(inputPath, { encoding: 'utf8' });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        const compiledGroups = this.compileGroups(filterGroups);

        // Path and stream setup
        const tmpDir = os.tmpdir();
        const prefix = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string>(Constants.Configuration.TempFilePrefix) || Constants.Defaults.TempFilePrefix;
        const now = new Date();
        const uniqueSuffix = Math.random().toString(36).substring(7);
        const outputFilename = `${prefix}${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}_${now.getMilliseconds().toString().padStart(3, '0')}_${uniqueSuffix}.log`;
        const outputPath = path.join(tmpDir, outputFilename);
        const outputStream = fs.createWriteStream(outputPath);

        // Surface stream errors as rejections
        const streamError = new Promise<never>((_, reject) => {
            fileStream.on('error', (err) => reject(new Error(`Failed to read file ${inputPath}: ${err.message}`)));
            rl.on('error', (err) => reject(new Error(`Readline error while processing ${inputPath}: ${err.message}`)));
            outputStream.on('error', (err) => reject(new Error(`Failed to write output file ${outputPath}: ${err.message}`)));
        });

        let processed = 0;
        let matched = 0;

        const maxBeforeLines = DEFAULT_MAX_BEFORE_LINES;
        const beforeBuffer = new CircularBuffer<{ line: string, index: number }>(maxBeforeLines);
        let afterLinesRemaining = 0;
        let lastWrittenLineIndex = -1; // Index of the last line written to output

        // Line Mapping: Index = Output Line Number, Value = Source Line Number
        const lineMapping: number[] = [];

        // Padding calculation
        const prependLineNumbers = options?.prependLineNumbers || false;
        const totalLineCount = options?.totalLineCount || DEFAULT_MAX_LINE_COUNT;
        const padding = totalLineCount.toString().length;

        const formatLine = (line: string, index: number) => {
            if (prependLineNumbers) {
                return `${index.toString().padStart(padding, '0')}: ${line}`;
            }
            return line;
        };

        const waitForDrain = () => new Promise<void>(resolve => outputStream.once('drain', resolve));

        const writeLine = (line: string, originalIndex: number) => {
            const ok = outputStream.write(formatLine(line, originalIndex) + '\n');
            lineMapping.push(originalIndex);
            return ok;
        };

        const processLines = async () => {
            for await (const line of rl) {
                processed++; // 1-based index
                const matchResult = this.checkMatchCompiled(line, compiledGroups);

                if (matchResult.isMatched) {
                    matched++;
                    const maxContext = matchResult.contextLines;

                    // 1. Write 'Before' context lines that haven't been written yet
                    const allBuffer = beforeBuffer.getAll();
                    const startIndex = Math.max(0, allBuffer.length - maxContext);
                    const linesToSubmit = allBuffer.slice(startIndex);

                    for (let i = 0; i < linesToSubmit.length; i++) {
                        const bufferedItem = linesToSubmit[i];
                        if (bufferedItem.index > lastWrittenLineIndex) {
                            if (!writeLine(bufferedItem.line, bufferedItem.index)) {
                                await waitForDrain();
                            }
                            lastWrittenLineIndex = bufferedItem.index;
                        }
                    }

                    // 2. Write current matching line
                    if (processed > lastWrittenLineIndex) {
                        if (!writeLine(line, processed)) {
                            await waitForDrain();
                        }
                        lastWrittenLineIndex = processed;
                    }

                    // 3. Set/Update 'After' context counter
                    afterLinesRemaining = Math.max(afterLinesRemaining, maxContext);
                } else if (afterLinesRemaining > 0) {
                    // This is an 'After' context line
                    if (processed > lastWrittenLineIndex) {
                        if (!writeLine(line, processed)) {
                            await waitForDrain();
                        }
                        lastWrittenLineIndex = processed;
                    }
                    afterLinesRemaining--;
                }

                // Maintain before buffer using CircularBuffer
                beforeBuffer.push({ line, index: processed });
            }

            outputStream.end();
            await new Promise<void>(resolve => outputStream.on('finish', resolve));
        };

        // Race: process lines vs stream errors
        await Promise.race([processLines(), streamError]);

        // Adjust mapping to be 0-based for VS Code Positions
        const adjustedMapping = lineMapping.map(l => l - 1);

        // Register with FileHierarchyService
        // If originalPath is provided (e.g. from Workflow), use it as the parent
        const parentPath = options?.originalPath || inputPath;
        const sourceUri = vscode.Uri.file(parentPath);
        const outputUri = vscode.Uri.file(outputPath);
        FileHierarchyService.getInstance().registerChild(sourceUri, outputUri, 'filter');

        return { outputPath, processed, matched, lineMapping: adjustedMapping };
    }

    /**
     * Checks if a line matches filters using pre-compiled regex groups.
     */
    public checkMatchCompiled(line: string, compiledGroups: CompiledGroup[]): { isMatched: boolean, contextLines: number } {
        let maxContext = 0;
        let anyIncludeDefined = false;
        let matchFound = false;

        if (compiledGroups.length === 0) {
            return { isMatched: false, contextLines: 0 };
        }

        for (const group of compiledGroups) {
            // Excludes: Highest priority. If ANY active group excludes the line, it's out.
            for (const excludeRegex of group.excludes) {
                excludeRegex.lastIndex = 0; // Reset state for global regex
                if (excludeRegex.test(line)) {
                    return { isMatched: false, contextLines: 0 };
                }
            }

            // Includes: OR logic between groups.
            // If any group has include filters, we enter "include mode".
            if (group.includes.length > 0) {
                anyIncludeDefined = true;
                for (const include of group.includes) {
                    include.regex.lastIndex = 0; // Reset state for global regex
                    if (include.regex.test(line)) {
                        matchFound = true;
                        maxContext = Math.max(maxContext, include.contextLine);
                    }
                }
            }
        }

        // Final determination:
        // 1. If no include filters are defined anywhere, we include everything (that wasn't excluded).
        // 2. If include filters are defined, we only include if at least ONE matched.
        const isMatched = !anyIncludeDefined || matchFound;

        return { isMatched, contextLines: maxContext };
    }
}
