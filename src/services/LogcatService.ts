
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { AdbDevice, LogcatSession, LogcatTag, LogPriority } from '../models/LogcatModels';
import * as crypto from 'crypto';

import { Logger } from './Logger';

export class LogcatService {
    private sessions: Map<string, LogcatSession> = new Map();
    private processes: Map<string, cp.ChildProcess> = new Map();
    private buffers: Map<string, string[]> = new Map();
    private flushTimers: Map<string, NodeJS.Timeout> = new Map();

    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private _onDidReceiveLog = new vscode.EventEmitter<{ sessionId: string, line: string }>();
    public readonly onDidReceiveLog = this._onDidReceiveLog.event;

    constructor(private logger: Logger) { }

    private deviceTargetApps: Map<string, string> = new Map(); // deviceId -> packageName

    private getAdbPath(): string {
        return vscode.workspace.getConfiguration('logmagnifier').get<string>('adbPath') || 'adb';
    }

    public async getDevices(): Promise<AdbDevice[]> {
        return new Promise((resolve, reject) => {
            const adbPath = this.getAdbPath();
            this.logger.info(`[ADB] Executing: ${adbPath} devices -l`);

            cp.exec(`${adbPath} devices -l`, async (err, stdout, stderr) => {
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
                                (device as any)[key] = value;
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
                        } catch (e) {
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

            cp.exec(`${adbPath} -s ${deviceId} shell pm list packages ${filter}`, (err, stdout) => {
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
            // ps -A to get all processes. 
            // format: USER PID PPID VSZ RSS WCHAN ADDR S NAME
            // Check if -A is supported (newer android) or just ps
            const cmd = `${adbPath} -s ${deviceId} shell ps -A`;
            this.logger.info(`[ADB] Getting running apps: ${cmd}`);

            cp.exec(cmd, (err, stdout) => {
                if (err) {
                    // Fallback to simple 'ps' if -A fails (older Android)
                    this.logger.warn(`[ADB] ps -A failed, trying ps: ${err.message}`);
                    cp.exec(`${adbPath} -s ${deviceId} shell ps`, (err2, stdout2) => {
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
        // Last column is usually NAME.
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 8) {
                const name = parts[parts.length - 1];
                if (name && name.includes('.') && !name.startsWith('[')) {
                    running.add(name);
                }
            }
        }
        return running;
    }

    public async getAppPid(deviceId: string, packageName: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            // pidof might not be available on all android versions, but common enough. 
            // Alternative: ps -A | grep package
            cp.exec(`${adbPath} -s ${deviceId} shell pidof -s ${packageName}`, (err, stdout) => {
                if (err || !stdout.trim()) {
                    resolve(undefined);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
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
            isRunning: false
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
        if (!session || session.isRunning) { return; }

        try {
            const adbPath = this.getAdbPath();
            const defaultOptions = vscode.workspace.getConfiguration('logmagnifier').get<string>('adbLogcatDefaultOptions') || '-v threadtime -T 1';

            // basic args: -s <device> logcat
            const args = ['-s', session.device.id, 'logcat'];

            // Add default options (split by space)
            if (defaultOptions.trim().length > 0) {
                args.push(...defaultOptions.split(/\s+/));
            }

            // PID Filter
            if (session.device.targetApp && session.device.targetApp !== 'all') {
                const pid = await this.getAppPid(session.device.id, session.device.targetApp);
                if (pid) {
                    this.logger.info(`[ADB] Resolved PID for ${session.device.targetApp}: ${pid}`);
                    args.push(`--pid=${pid}`);
                } else {
                    vscode.window.showWarningMessage(`App ${session.device.targetApp} is not running. Starting logcat without PID filter.`);
                }
            }

            // Add tag filters
            // Format: Tag:Priority ... *:S (if we want to exclude others)
            // If no tags, we usually show everything (*:V)
            // If tags are present, we typically default others to Silent (*:S) unless specified

            if (session.tags.length > 0) {
                session.tags.forEach(tag => {
                    if (tag.isEnabled) {
                        args.push(`${tag.name}:${tag.priority}`);
                    }
                });
                // If we have specific filters, we likely want to silence everything else
                // But user might want "Mixed Mode" where they see everything but highlighted.
                // For 'filtering' via adb, we add *:S.
                // Let's assume strict filtering for now as per "Filter View" paradigm.
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
                const header = `Logcat: ${session.name}\n${'-'.repeat(50)}\n`;
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
                vscode.window.showErrorMessage(`Failed to start logcat process: ${err.message}`);
                session.isRunning = false;
                this._onDidChangeSessions.fire();
            });

        } catch (error) {
            this.logger.error(`[ADB] Exception starting logcat: ${error}`);
            vscode.window.showErrorMessage(`Failed to start logcat: ${error}`);
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

    // Buffering Logic
    private bufferLogs(sessionId: string, lines: string[]) {
        let buffer = this.buffers.get(sessionId) || [];
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
                console.warn('Output document closed, stopping session');
                this.stopSession(sessionId);
            }
        } catch (e) {
            console.error('Failed to write to logcat document', e);
        }
    }

    public async uninstallApp(deviceId: string, packageName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const adbPath = this.getAdbPath();
            this.logger.info(`[ADB] Uninstalling ${packageName} on ${deviceId}`);
            cp.exec(`${adbPath} -s ${deviceId} uninstall ${packageName}`, (err, stdout) => {
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
            cp.exec(`${adbPath} -s ${deviceId} shell pm clear ${packageName}`, (err, stdout) => {
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
            const cmd = `${adbPath} -s ${deviceId} shell run-as ${packageName} rm -rf cache code_cache`;
            cp.exec(cmd, (err, stdout) => {
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
}
