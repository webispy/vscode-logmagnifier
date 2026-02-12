import * as vscode from 'vscode';
import * as cp from 'child_process';
import { AdbDevice, LogcatSession, LogcatTag } from '../models/AdbModels';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

import { Logger } from './Logger';
import { Constants } from '../constants';

export class AdbService implements vscode.Disposable {
    private sessions: Map<string, LogcatSession> = new Map();
    private processes: Map<string, cp.ChildProcess> = new Map();
    private buffers: Map<string, string[]> = new Map();
    private flushTimers: Map<string, NodeJS.Timeout> = new Map();
    private recordingProcesses: Map<string, { process: cp.ChildProcess, remotePath: string, pid?: string }> = new Map(); // deviceId -> process info
    private stoppingDevices: Set<string> = new Set(); // deviceId

    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    constructor(private logger: Logger) { }

    private deviceTargetApps: Map<string, string> = new Map(); // deviceId -> packageName
    private getAdbPath(): string {
        return vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string>(Constants.Configuration.Adb.Path) || Constants.Defaults.AdbPath;
    }

    public async getDevices(): Promise<AdbDevice[]> {
        return new Promise((resolve, _reject) => {
            const adbPath = this.getAdbPath();
            this.logger.info(`[ADB] Executing: ${adbPath} devices -l`);

            cp.execFile(adbPath, ['devices', '-l'], async (err, stdout, _stderr) => {
                if (err) {
                    this.logger.error(`[ADB] Error running adb devices: ${err.message}`);
                    resolve([]);
                    return;
                }

                this.logger.info(`[ADB] Raw output:\n${stdout.trim()}`);

                const devices: AdbDevice[] = [];
                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (!line.trim() || line.startsWith('List of devices attached')) {
                        continue;
                    }
                    // Parse line: "serial product:p model:m device:d transport_id:t"
                    const parts = line.split(/\s+/);
                    if (parts.length >= 2) {
                        const id = parts[0];
                        const type = parts[1];
                        const device: AdbDevice = { id, type };

                        for (let i = 2; i < parts.length; i++) {
                            const [key, value] = parts[i].split(':');
                            if (key && value) {
                                if (key === 'transport_id') {
                                    device.transportId = value;
                                } else {
                                    (device as unknown as Record<string, unknown>)[key] = value;
                                }
                            }
                        }
                        this.logger.info(`[ADB] Parsed device: ${JSON.stringify(device)}`);
                        devices.push(device);
                    }
                }

                // Validate Target Apps
                const validationPromises = devices.map(async (device) => {
                    const storedTarget = this.deviceTargetApps.get(device.id);
                    if (storedTarget && storedTarget !== 'all') {
                        // Check if running
                        try {
                            const runningApps = await this.getRunningApps(device.id);
                            if (!runningApps.has(storedTarget)) {
                                this.logger.info(`[ADB] Target app ${storedTarget} not running on ${device.id}. Resetting to all.`);
                                this.deviceTargetApps.set(device.id, 'all');
                                device.targetApp = 'all';
                            } else {
                                device.targetApp = storedTarget;
                            }
                        } catch (_e) {
                            this.logger.warn(`[ADB] Failed to check running apps for ${device.id}, keeping stored target.`);
                            device.targetApp = storedTarget;
                        }
                    } else {
                        device.targetApp = 'all';
                    }
                });

                await Promise.all(validationPromises);
                resolve(devices);
            });
        });
    }

    public async getInstalledPackages(deviceId: string): Promise<string[]> {
        const packages = await this.fetchPackages(deviceId);
        return Array.from(packages).sort();
    }

    public async getThirdPartyPackages(deviceId: string): Promise<Set<string>> {
        return this.fetchPackages(deviceId, '-3');
    }

    private async fetchPackages(deviceId: string, filter: string = ''): Promise<Set<string>> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            const filterLog = filter ? ` with filter '${filter}'` : '';
            this.logger.info(`[ADB] Getting packages for device ${deviceId}${filterLog}...`);

            const args = ['-s', deviceId, 'shell', 'pm', 'list', 'packages'];
            if (filter) {
                args.push(filter);
            }

            cp.execFile(adbPath, args, (err, stdout, _stderr) => {
                if (err) {
                    this.logger.error(`[ADB] Error getting packages: ${err.message}`);
                    resolve(new Set());
                    return;
                }
                const packages = stdout.split('\n')
                    .filter(line => line.startsWith('package:'))
                    .map(line => line.replace('package:', '').trim());
                this.logger.info(`[ADB] Found ${packages.length} packages.`);
                resolve(new Set(packages));
            });
        });
    }

    public async getRunningApps(deviceId: string): Promise<Set<string>> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            // ps -A (newer Android) or fallback to ps (older Android)
            // format: USER PID PPID VSZ RSS WCHAN ADDR S NAME
            const cmd = `${adbPath} -s ${deviceId} shell ps -A`;
            this.logger.info(`[ADB] Getting running apps: ${cmd}`);

            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'ps', '-A'], (err, stdout) => {
                if (err) {
                    // Fallback to simple 'ps' if -A fails (older Android)
                    this.logger.warn(`[ADB] ps -A failed, trying ps: ${err.message}`);
                    cp.execFile(adbPath, ['-s', deviceId, 'shell', 'ps'], (err2, stdout2) => {
                        if (err2) {
                            this.logger.error(`[ADB] Error getting running apps: ${err2.message}`);
                            resolve(new Set());
                            return;
                        }
                        this.parsePsOutput(stdout2).then(resolve);
                    });
                    return;
                }
                this.parsePsOutput(stdout).then(resolve);
            });
        });
    }

    private async parsePsOutput(output: string): Promise<Set<string>> {
        const running = new Set<string>();
        const lines = output.split('\n');
        // valid package names usually look like com.example.app, but ps output has many columns.
        // Standard Android ps: USER PID ... NAME (Last column, but might be space separated arguments if we aren't careful, though usually package name is single token)
        // However, some ps outputs have 9 columns. Index 8 is NAME.
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 9) {
                // Join everything from index 8 onwards to handle potential spaces (rare for package names but good for safety)
                const name = parts.slice(8).join(' '); // NAME is usually at index 8
                if (name && name.includes('.') && !name.startsWith('[')) {
                    running.add(name);
                }
            } else if (parts.length > 0) {
                // Fallback for non-standard ps or older androids where column count might differ
                // Just take the last part if it looks like a package
                const name = parts[parts.length - 1];
                if (name && name.includes('.') && !name.startsWith('[')) {
                    running.add(name);
                }
            }
        }
        return running;
    }

    public async getAppPid(deviceId: string, packageName: string): Promise<string | undefined> {
        return this.findPid(deviceId, packageName);
    }

    private async findPid(deviceId: string, search: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            // Try pidof first (fastest)
            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'pidof', '-s', search], (err, stdout) => {
                if (!err && stdout.trim()) {
                    resolve(stdout.trim());
                    return;
                }

                // Fallback: ps -A (newer) or ps (older)
                cp.execFile(adbPath, ['-s', deviceId, 'shell', 'ps', '-A'], (err2, stdout2) => {
                    if (err2) {
                        // Try simple ps
                        cp.execFile(adbPath, ['-s', deviceId, 'shell', 'ps'], (err3, stdout3) => {
                            if (err3) {
                                resolve(undefined);
                                return;
                            }
                            resolve(this.parsePsForPid(stdout3, search));
                        });
                        return;
                    }
                    resolve(this.parsePsForPid(stdout2, search));
                });
            });
        });
    }

    private parsePsForPid(output: string, search: string): string | undefined {
        const lines = output.split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) { continue; }
            // 2nd column is typically PID in standard Android ps (USER PID ...)
            const pid = parts[1];
            // Name starts at index 8
            const name = parts.slice(8).join(' ');

            if (name === search || name.endsWith(`/${search}`)) {
                return pid;
            }
        }
        return undefined;
    }

    public setTargetApp(device: AdbDevice, packageName: string) {
        this.deviceTargetApps.set(device.id, packageName);
        device.targetApp = packageName;
        this._onDidChangeSessions.fire(); // Refresh tree
    }

    public createSession(name: string, device: AdbDevice): LogcatSession {
        const session: LogcatSession = {
            id: crypto.randomUUID(),
            name,
            device,
            tags: [],
            isRunning: false,
            useStartFromCurrentTime: true // Default to true (current behavior with default options)
        };
        this.sessions.set(session.id, session);
        this._onDidChangeSessions.fire();
        this.logger.info(`[Session] Created session '${name}' for device ${device.id}`);
        return session;
    }

    public getSessions(): LogcatSession[] {
        return Array.from(this.sessions.values());
    }

    public getSession(id: string): LogcatSession | undefined {
        return this.sessions.get(id);
    }

    public removeSession(id: string) {
        this.stopSession(id);
        this.sessions.delete(id);
        this._onDidChangeSessions.fire();
        this.logger.info(`[Session] Removed session ${id}`);
    }

    public async startSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (!session || session.isRunning) {
            return;
        }

        if (session.outputDocumentUri) {
            const uri = vscode.Uri.parse(session.outputDocumentUri);
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            // If document is not found or is closed, clear the reference to create a new one
            if (!doc || doc.isClosed) {
                session.outputDocumentUri = undefined;
            }
        }

        try {
            const adbPath = this.getAdbPath();
            const defaultOptions = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string>(Constants.Configuration.Adb.DefaultOptions) || Constants.Defaults.AdbDefaultOptions;

            // basic args: -s <device> logcat
            const args = ['-s', session.device.id, 'logcat'];

            // Add default options (split by space)
            // If useStartFromCurrentTime is false, we filter OUT time flags (-T or -t) from default options.
            // If true, we ensure -T 1 is present later if not in default options.

            const startFromNow = session.useStartFromCurrentTime !== false; // Default true

            if (defaultOptions.trim().length > 0) {
                const parts = defaultOptions.split(/\s+/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    // Check for time flags
                    if (part === '-T' || part === '-t') {
                        if (!startFromNow) {
                            // Skip this and the next argument (the value)
                            i++;
                            continue;
                        }
                    }
                    args.push(part);
                }
            }

            // If startFromNow is enabled and no time flag (-T or -t) exists in args (from defaultOptions),
            // force adding '-T 1' to ensure we only show logs from now.

            const hasTimeArg = args.includes('-T') || args.includes('-t');
            if (startFromNow && !hasTimeArg) {
                args.push('-T', '1');
            }

            // PID Filter
            if (session.device.targetApp && session.device.targetApp !== 'all') {
                const pid = await this.getAppPid(session.device.id, session.device.targetApp);
                if (pid) {
                    this.logger.info(`[ADB] Resolved PID for ${session.device.targetApp}: ${pid}`);
                    args.push(`--pid=${pid}`);
                } else {
                    vscode.window.showWarningMessage(Constants.Messages.Warn.AppNotRunning.replace('{0}', session.device.targetApp));
                }
            }

            // Add tag filters (Tag:Priority).
            // If tags are present, default others to Silent (*:S). Otherwise show all (*:V).

            if (session.tags.length > 0) {
                session.tags.forEach(tag => {
                    if (tag.isEnabled) {
                        args.push(`${tag.name}:${tag.priority}`);
                    }
                });
                // Strictly filter logs based on the tags.
                args.push('*:S');
            } else {
                args.push('*:V');
            }

            const command = `${adbPath} ${args.join(' ')}`;
            this.logger.info(`[ADB] Starting logcat: ${command}`);

            const child = cp.spawn(adbPath, args);
            this.processes.set(sessionId, child);
            session.isRunning = true;
            this._onDidChangeSessions.fire();

            // Open document if not already associated
            if (!session.outputDocumentUri) {
                const now = new Date();
                const pad = (n: number) => n.toString().padStart(2, '0');
                const pad3 = (n: number) => n.toString().padStart(3, '0');

                // UTC
                const utcStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.${pad3(now.getUTCMilliseconds())}`;

                // Local
                const off = -now.getTimezoneOffset();
                const sign = off >= 0 ? '+' : '-';
                const absOff = Math.abs(off);
                const offH = Math.floor(absOff / 60);
                const offM = absOff % 60;
                const tz = `${sign}${pad(offH)}:${pad(offM)}`;
                const localStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad3(now.getMilliseconds())} ${tz}`;

                const header = `Logcat session: ${session.name}\n` +
                    `Command: ${command}\n` +
                    `Start time\n` +
                    `- ${localStr}\n` +
                    `- ${utcStr} +00:00\n` +
                    `${'='.repeat(80)}\n`;
                const doc = await vscode.workspace.openTextDocument({ language: 'log', content: header });
                await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                session.outputDocumentUri = doc.uri.toString();
            }

            // Setup output handling
            child.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                this.bufferLogs(sessionId, lines);
            });

            child.stderr.on('data', (data) => {
                // Logcat stderr often contains useful info too (like "unexpected EOF")
                const lines = data.toString().split('\n');
                this.bufferLogs(sessionId, lines.map((l: string) => `[STDERR] ${l}`));
            });

            child.on('close', (code) => {
                this.logger.info(`[ADB] Logcat process exited with code ${code}`);
                session.isRunning = false;
                this.processes.delete(sessionId);
                this._onDidChangeSessions.fire();
                this.flushLogs(sessionId); // Flush remaining
            });

            child.on('error', (err) => {
                this.logger.error(`[ADB] Failed to start logcat process: ${err.message}`);
                vscode.window.showErrorMessage(Constants.Messages.Error.LogcatStartFailed.replace('{0}', err.message));
                session.isRunning = false;
                this._onDidChangeSessions.fire();
            });

        } catch (error) {
            this.logger.error(`[ADB] Exception starting logcat: ${error}`);
            vscode.window.showErrorMessage(Constants.Messages.Error.LogcatStartFailed.replace('{0}', String(error)));
        }
    }

    public stopSession(sessionId: string) {
        const child = this.processes.get(sessionId);
        if (child) {
            child.kill();
            this.processes.delete(sessionId);
        }
        const session = this.sessions.get(sessionId);
        if (session) {
            session.isRunning = false;
            this._onDidChangeSessions.fire();
        }
        // clear flush timer
        const timer = this.flushTimers.get(sessionId);
        if (timer) {
            clearInterval(timer);
            this.flushTimers.delete(sessionId);
        }
    }

    public addTag(sessionId: string, tag: LogcatTag) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            session.tags.push(tag);
            this._onDidChangeSessions.fire();
        }
    }

    public removeTag(sessionId: string, tagId: string) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            session.tags = session.tags.filter(t => t.id !== tagId);
            this._onDidChangeSessions.fire();
        }
    }

    public updateTag(sessionId: string, tag: LogcatTag) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            const index = session.tags.findIndex(t => t.id === tag.id);
            if (index !== -1) {
                session.tags[index] = tag;
                this._onDidChangeSessions.fire();
            }
        }
    }

    public toggleSessionTimeFilter(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            session.useStartFromCurrentTime = !session.useStartFromCurrentTime;
            this.logger.info(`[Session] Toggled time filter for ${sessionId} to ${session.useStartFromCurrentTime}`);
            this._onDidChangeSessions.fire();
        }
    }

    // Buffering Logic
    private bufferLogs(sessionId: string, lines: string[]) {
        const buffer = this.buffers.get(sessionId) || [];
        // Filter out empty lines if needed
        const newLines = lines.filter(l => l.length > 0);
        buffer.push(...newLines);
        this.buffers.set(sessionId, buffer);

        if (!this.flushTimers.has(sessionId)) {
            const timer = setInterval(() => this.flushLogs(sessionId), 500); // Flush every 500ms
            this.flushTimers.set(sessionId, timer);
        }
    }

    private async flushLogs(sessionId: string) {
        const buffer = this.buffers.get(sessionId);
        if (!buffer || buffer.length === 0) {
            return;
        }

        const session = this.sessions.get(sessionId);
        if (!session || !session.outputDocumentUri) {
            this.buffers.set(sessionId, []); // Clear buffer if nowhere to write
            return;
        }

        const contentToAppend = buffer.join('\n') + '\n';
        this.buffers.set(sessionId, []); // Clear buffer immediately to capture new logs

        try {
            const uri = vscode.Uri.parse(session.outputDocumentUri);
            // We need to find the document. It might be closed.
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());

            if (doc) {
                const edit = new vscode.WorkspaceEdit();
                const lastLine = doc.lineCount;
                const position = new vscode.Position(lastLine, 0);
                edit.insert(uri, position, contentToAppend);
                const success = await vscode.workspace.applyEdit(edit);

                if (success) {
                    // Auto-scroll
                    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
                    if (editor) {
                        const newLastLine = doc.lineCount - 1;
                        const newPosition = new vscode.Position(newLastLine, 0);
                        editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.Default);
                    }
                }
            } else {
                // specific behavior if doc is closed? Close session?
                this.logger.warn('Output document closed, stopping session');
                this.stopSession(sessionId);
            }
        } catch (e) {
            this.logger.error(`Failed to write to logcat document: ${e}`);
        }
    }

    public async uninstallApp(deviceId: string, packageName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            this.logger.info(`[ADB] Uninstalling ${packageName} on ${deviceId}`);
            cp.execFile(adbPath, ['-s', deviceId, 'uninstall', packageName], (err, stdout) => {
                if (err) {
                    this.logger.error(`[ADB] Uninstall failed: ${err.message}`);
                    resolve(false);
                    return;
                }
                this.logger.info(`[ADB] Uninstall output: ${stdout.trim()}`);
                resolve(stdout.includes('Success'));
            });
        });
    }

    public async clearAppStorage(deviceId: string, packageName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            this.logger.info(`[ADB] Clearing storage for ${packageName} on ${deviceId}`);
            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'pm', 'clear', packageName], (err, stdout) => {
                if (err) {
                    this.logger.error(`[ADB] Clear storage failed: ${err.message}`);
                    resolve(false);
                    return;
                }
                this.logger.info(`[ADB] Clear storage output: ${stdout.trim()}`);
                resolve(stdout.includes('Success'));
            });
        });
    }

    public async clearAppCache(deviceId: string, packageName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            this.logger.info(`[ADB] Clearing cache for ${packageName} on ${deviceId}`);
            // Note: This only works for debuggable apps or rooted devices usually via run-as
            // For non-debuggable apps without root, clearing just cache isn't easily possible via adb without pm clear
            // But we try nonetheless.
            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'run-as', packageName, 'rm', '-rf', 'cache', 'code_cache'], (err, stdout) => {
                if (err) {
                    this.logger.warn(`[ADB] Clear cache failed (might need debuggable app): ${err.message}`);
                    // We interpret 'run-as: package not debuggable' as a sort of failure but we resolve true so UI isn't blocked?
                    // actually resolve false to maybe warn user?
                    // Detailed error often in stderr.
                    resolve(false);
                    return;
                }
                this.logger.info(`[ADB] Clear cache output: ${stdout.trim()}`);
                resolve(true); // rm -rf usually doesn't output 'Success'
            });
        });
    }
    public async runDumpsysPackage(deviceId: string, packageName: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const adbPath = this.getAdbPath();
            const cmd = `${adbPath} -s ${deviceId} shell dumpsys package ${packageName}`;
            this.logger.info(`[ADB] Running dumpsys: ${cmd}`);

            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'dumpsys', 'package', packageName], { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, _stderr) => {
                if (err) {
                    this.logger.error(`[ADB] Dumpsys failed: ${err.message}`);
                    reject(err);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    public async runDumpsysMeminfo(deviceId: string, packageName: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const adbPath = this.getAdbPath();
            const cmd = `${adbPath} -s ${deviceId} shell dumpsys meminfo ${packageName}`;
            this.logger.info(`[ADB] Running dumpsys meminfo: ${cmd}`);

            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'dumpsys', 'meminfo', packageName], { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, _stderr) => {
                if (err) {
                    this.logger.error(`[ADB] Dumpsys meminfo failed: ${err.message}`);
                    reject(err);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    public async runDumpsysActivity(deviceId: string, packageName: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const adbPath = this.getAdbPath();
            const cmd = `${adbPath} -s ${deviceId} shell dumpsys activity ${packageName}`;
            this.logger.info(`[ADB] Running dumpsys activity: ${cmd}`);

            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'dumpsys', 'activity', packageName], { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, _stderr) => {
                if (err) {
                    this.logger.error(`[ADB] Dumpsys activity failed: ${err.message}`);
                    reject(err);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    public async captureScreenshot(deviceId: string, localOutputPath: string): Promise<boolean> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            const remotePath = `/data/local/tmp/vscode_screenshot_${Date.now()}.png`;

            this.logger.info(`[ADB] Capturing screenshot on ${deviceId} to ${remotePath}`);

            // 1. Capture to remote temp file
            const captureArgs = ['-s', deviceId, 'shell', 'screencap', '-p', remotePath];
            this.logger.info(`[ADB] Command: ${adbPath} ${captureArgs.join(' ')}`);

            cp.execFile(adbPath, captureArgs, async (err) => {
                if (err) {
                    this.logger.error(`[ADB] Screenshot capture failed: ${err.message}`);
                    resolve(false);
                    return;
                }

                // 2. Pull file to local
                this.logger.info(`[ADB] Pulling screenshot to ${localOutputPath}`);
                const pullArgs = ['-s', deviceId, 'pull', remotePath, localOutputPath];
                this.logger.info(`[ADB] Command: ${adbPath} ${pullArgs.join(' ')}`);

                cp.execFile(adbPath, pullArgs, async (pullErr) => {
                    if (pullErr) {
                        this.logger.error(`[ADB] Screenshot pull failed: ${pullErr.message}`);
                        // Try cleanup anyway
                        const cleanupArgs = ['-s', deviceId, 'shell', 'rm', remotePath];
                        this.logger.info(`[ADB] Command (cleanup): ${adbPath} ${cleanupArgs.join(' ')}`);
                        cp.execFile(adbPath, cleanupArgs, (_e) => { /* ignore */ });
                        resolve(false);
                        return;
                    }

                    // 3. Cleanup remote file
                    this.logger.info(`[ADB] Cleaning up ${remotePath}`);
                    const cleanupArgs = ['-s', deviceId, 'shell', 'rm', remotePath];
                    this.logger.info(`[ADB] Command: ${adbPath} ${cleanupArgs.join(' ')}`);

                    cp.execFile(adbPath, cleanupArgs, (cleanErr) => {
                        if (cleanErr) {
                            this.logger.warn(`[ADB] Failed to cleanup remote screenshot: ${cleanErr.message}`);
                        }
                        resolve(true);
                    });
                });
            });
        });
    }

    public isDeviceRecording(deviceId: string): boolean {
        return this.recordingProcesses.has(deviceId);
    }

    public isDeviceStopping(deviceId: string): boolean {
        return this.stoppingDevices.has(deviceId);
    }

    public async startRecording(deviceId: string): Promise<boolean> {
        if (this.isDeviceRecording(deviceId) || this.isDeviceStopping(deviceId)) {
            return false;
        }

        const adbPath = this.getAdbPath();
        const timestamp = new Date().getTime();
        const remotePath = `/data/local/tmp/screenrecord_${timestamp}.mp4`;

        this.logger.info(`[ADB] Starting recording on ${deviceId} to ${remotePath}`);

        const args = ['-s', deviceId, 'shell', 'screenrecord', remotePath];
        this.logger.info(`[ADB] Spawning (stdio: pipe): ${adbPath} ${args.join(' ')}`);

        // Use 'pipe' for stdout/stderr to capture logs for debugging.
        // Stdin is ignored to avoid holding the process open unnecessarily if not used.
        const child = cp.spawn(adbPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        if (child.stdout) {
            child.stdout.on('data', (data) => {
                this.logger.info(`[ADB][screenrecord] stdout: ${data.toString().trim()}`);
            });
        }
        if (child.stderr) {
            child.stderr.on('data', (data) => {
                this.logger.error(`[ADB][screenrecord] stderr: ${data.toString().trim()}`);
            });
        }

        child.on('error', (err) => {
            this.logger.error(`[ADB] Failed to start screenrecord: ${err.message}`);
            this.recordingProcesses.delete(deviceId);
            this._onDidChangeSessions.fire();
            vscode.window.showErrorMessage(Constants.Messages.Error.RecordingFailed.replace('{0}', err.message));
        });

        child.on('close', async (code) => {
            this.logger.info(`[ADB] Local adb process closed on ${deviceId} (code ${code})`);
            this.recordingProcesses.delete(deviceId);

            // Trigger pull regardless of how it stopped (manual stop or limit reached).

            this._onDidChangeSessions.fire();

            // Check file and pull immediately (stabilization check is inside checkAndPullRecording)
            await this.checkAndPullRecording(deviceId, remotePath);

            // Ensure stopping state is cleared if it was set
            if (this.stoppingDevices.has(deviceId)) {
                this.stoppingDevices.delete(deviceId);
                this._onDidChangeSessions.fire();
            }
        });

        // Store process info
        this.recordingProcesses.set(deviceId, { process: child, remotePath });
        this._onDidChangeSessions.fire();

        // Find PID
        setTimeout(async () => {
            const pid = await this.findPid(deviceId, 'screenrecord');
            if (pid) {
                this.logger.info(`[ADB] Remote screenrecord PID: ${pid}`);
                const info = this.recordingProcesses.get(deviceId);
                if (info) {
                    info.pid = pid;
                }
            }
        }, 1000);

        return true;
    }

    public async stopRecording(deviceId: string): Promise<void> {
        const info = this.recordingProcesses.get(deviceId);
        if (!info) {
            this.logger.warn(`[ADB] No recording session found for ${deviceId}`);
            return;
        }

        // Set stopping state to show spinner
        this.stoppingDevices.add(deviceId);
        this._onDidChangeSessions.fire();

        this.logger.info(`[ADB] Stopping recording on ${deviceId}`);
        const adbPath = this.getAdbPath();

        // 1. Send explicit SIGINT to remote process
        let pid = info.pid;
        if (!pid) {
            pid = await this.findPid(deviceId, 'screenrecord');
        }

        if (pid) {
            this.logger.info(`[ADB] Sending SIGINT to remote process ${pid}...`);

            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'kill', '-2', pid], (err) => {
                if (err) {
                    this.logger.warn(`[ADB] Failed to kill -2: ${err.message}`);
                } else {
                    this.logger.info(`[ADB] Signal sent.`);
                }
            });
            // Removed fixed delay here
        } else {
            this.logger.warn(`[ADB] Could not determine remote PID. Stopping local process only.`);
        }

        // 2. Wait for remote process to die
        this.logger.info(`[ADB] Waiting for remote screenrecord to finish...`);
        const maxWait = 5000; // 5 seconds
        const start = Date.now();

        while (Date.now() - start < maxWait) {
            const currentPid = await this.findPid(deviceId, 'screenrecord');
            if (!currentPid) {
                this.logger.info(`[ADB] Remote screenrecord process gone.`);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 3. Kill local process to cleanup
        if (info.process) {
            this.logger.info(`[ADB] Killing local adb process...`);
            info.process.kill();
        }

        // Cleanup map logic and stopping state clearing is handled in 'close' handler.
    }

    private async checkAndPullRecording(deviceId: string, remotePath: string): Promise<void> {
        const adbPath = this.getAdbPath();

        this.logger.info(`[ADB] Checking file status...`);
        let attempts = 0;
        const maxAttempts = 10;
        let previousSize = 0;

        const checkLoop = async () => {
            while (attempts < maxAttempts) {

                const result = await new Promise<{ size: number, output: string }>((resolve) => {
                    cp.execFile(adbPath, ['-s', deviceId, 'shell', 'ls', '-l', remotePath], (_err, stdout) => {
                        attempts++;
                        let size = 0;
                        if (stdout) {
                            const parts = stdout.trim().split(/\s+/);
                            if (parts.length >= 5) {
                                size = parseInt(parts[4], 10);
                            }
                        }
                        resolve({ size, output: stdout?.trim() || '' });
                    });
                });

                this.logger.info(`[ADB] File size check (${attempts}/${maxAttempts}): ${result.size} bytes`);

                if (result.size > 0 && result.size === previousSize) {
                    this.logger.info(`[ADB] File size stabilized at ${result.size} bytes`);
                    await this.pullRecording(deviceId, remotePath);
                    return;
                } else if (result.size > 0 && attempts >= maxAttempts) {
                    this.logger.warn(`[ADB] Max attempts reached. File size: ${result.size} bytes`);
                    await this.pullRecording(deviceId, remotePath);
                    return;
                } else if (result.size === 0 && attempts >= maxAttempts) {
                    this.logger.error(`[ADB] File size is still 0 after ${maxAttempts} attempts.`);
                    vscode.window.showErrorMessage(Constants.Messages.Error.RecordingEmpty);
                    return;
                }

                previousSize = result.size;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        };

        await checkLoop();
    }

    private async pullRecording(deviceId: string, remotePath: string) {
        const tmpDir = os.tmpdir();
        const now = new Date();
        const filename = `screenrecord_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.mp4`;
        const localPath = path.join(tmpDir, filename);

        const adbPath = this.getAdbPath();

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Pulling screen recording...",
            cancellable: false
        }, async (_progress) => {
            return new Promise<void>((resolve) => {
                const pullCmd = `${adbPath} -s ${deviceId} pull ${remotePath} "${localPath}"`;
                this.logger.info(`[ADB] Pulling video: ${pullCmd}`);

                cp.execFile(adbPath, ['-s', deviceId, 'pull', remotePath, localPath], async (err) => {
                    if (err) {
                        this.logger.error(`[ADB] Failed to pull recording: ${err.message}`);
                        vscode.window.showErrorMessage(Constants.Messages.Error.RetrieveRecordingFailed);
                    } else {
                        this.logger.info(`[ADB] Video pulled successfully to ${localPath}`);
                        const uri = vscode.Uri.file(localPath);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }

                    // Cleanup remote
                    cp.execFile(adbPath, ['-s', deviceId, 'shell', 'rm', remotePath], (cleanupErr) => {
                        if (cleanupErr) {
                            this.logger.warn(`[ADB] Failed to cleanup remote file: ${cleanupErr.message}`);
                        } else {
                            this.logger.info(`[ADB] Remote file cleaned up`);
                        }
                        resolve();
                    });
                });
            });
        });
    }

    public async getShowTouchesState(deviceId: string): Promise<boolean> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            const cmd = `${adbPath} -s ${deviceId} shell settings get system show_touches`;
            this.logger.info(`[ADB] Getting show_touches: ${cmd}`);
            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'settings', 'get', 'system', 'show_touches'], (err, stdout) => {
                if (err) {
                    this.logger.error(`[ADB] Failed to get show_touches: ${err.message}`);
                    resolve(false);
                    return;
                }
                const result = stdout.trim();
                resolve(result === '1');
            });
        });
    }

    public async setShowTouchesState(deviceId: string, enable: boolean): Promise<void> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            const value = enable ? '1' : '0';
            const cmd = `${adbPath} -s ${deviceId} shell settings put system show_touches ${value}`;
            this.logger.info(`[ADB] Setting show_touches: ${cmd}`);
            cp.execFile(adbPath, ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'show_touches', value], (err) => {
                if (err) {
                    this.logger.error(`[ADB] Failed to set show_touches: ${err.message}`);
                }
                this._onDidChangeSessions.fire(); // Trigger refresh
                resolve();
            });
        });
    }

    public async toggleShowTouches(deviceId: string): Promise<void> {
        const current = await this.getShowTouchesState(deviceId);
        await this.setShowTouchesState(deviceId, !current);
    }

    public dispose() {
        this.flushTimers.forEach(timer => clearInterval(timer));
        this.flushTimers.clear();

        this.processes.forEach(proc => proc.kill());
        this.processes.clear();

        this.recordingProcesses.forEach(info => {
            if (info.process) {
                info.process.kill();
            }
        });
        this.recordingProcesses.clear();

        this._onDidChangeSessions.dispose();
    }
}
