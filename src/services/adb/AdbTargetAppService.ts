import * as vscode from 'vscode';
import { Logger } from '../Logger';
import { AdbClient } from './AdbClient';
import { AdbDevice } from '../../models/AdbModels';

export class AdbTargetAppService {
    private deviceTargetApps: Map<string, string> = new Map(); // deviceId -> packageName
    private _onDidChangeTargetApp = new vscode.EventEmitter<void>();
    public readonly onDidChangeTargetApp = this._onDidChangeTargetApp.event;

    constructor(private logger: Logger, private client: AdbClient) { }

    public setTargetApp(device: AdbDevice, packageName: string) {
        this.deviceTargetApps.set(device.id, packageName);
        device.targetApp = packageName;
        this._onDidChangeTargetApp.fire();
    }

    public getTargetApp(deviceId: string): string | undefined {
        return this.deviceTargetApps.get(deviceId);
    }

    public async getInstalledPackages(deviceId: string): Promise<string[]> {
        const packages = await this.fetchPackages(deviceId);
        return Array.from(packages).sort();
    }

    public async getThirdPartyPackages(deviceId: string): Promise<Set<string>> {
        return this.fetchPackages(deviceId, '-3');
    }

    private async fetchPackages(deviceId: string, filter: string = ''): Promise<Set<string>> {
        const args = ['-s', deviceId, 'shell', 'pm', 'list', 'packages'];
        if (filter) { args.push(filter); }

        try {
            const stdout = await this.client.execAdb(args);
            const packages = stdout.split('\n')
                .filter(line => line.startsWith('package:'))
                .map(line => line.replace('package:', '').trim());
            return new Set(packages);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`[ADB] Error getting packages: ${msg}`);
            return new Set();
        }
    }

    public async getRunningApps(deviceId: string): Promise<Set<string>> {
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'ps', '-A']);
            return this.parsePsOutput(stdout);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`[ADB] ps -A failed, trying ps: ${msg}`);
            try {
                const stdout2 = await this.client.execAdb(['-s', deviceId, 'shell', 'ps']);
                return this.parsePsOutput(stdout2);
            } catch (err2: unknown) {
                const msg2 = err2 instanceof Error ? err2.message : String(err2);
                this.logger.error(`[ADB] Error getting running apps: ${msg2}`);
                return new Set();
            }
        }
    }

    private parsePsOutput(output: string): Set<string> {
        const running = new Set<string>();
        const lines = output.split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 9) {
                const name = parts.slice(8).join(' ');
                if (name && name.includes('.') && !name.startsWith('[')) {
                    running.add(name);
                }
            } else if (parts.length > 0) {
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
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'pidof', '-s', search]);
            if (stdout.trim()) {
                return stdout.trim();
            }
        } catch {
            // Ignore error
        }

        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'ps', '-A']);
            if (stdout) {
                return this.parsePsForPid(stdout, search);
            }
        } catch {
            // Ignore error
        }

        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'ps']);
            if (stdout) {
                return this.parsePsForPid(stdout, search);
            }
        } catch {
            // Ignore error
        }

        return undefined;
    }

    private parsePsForPid(output: string, search: string): string | undefined {
        const lines = output.split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) {
                continue;
            }
            const pid = parts[1];
            const name = parts.slice(8).join(' ');
            if (name === search || name.endsWith(`/${search}`)) {
                return pid;
            }
        }
        return undefined;
    }

    public async uninstallApp(deviceId: string, packageName: string): Promise<boolean> {
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'uninstall', packageName]);
            return stdout.includes('Success');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`Uninstall failed: ${msg}`);
            return false;
        }
    }

    public async clearAppStorage(deviceId: string, packageName: string): Promise<boolean> {
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'pm', 'clear', packageName]);
            return stdout.includes('Success');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`Clear storage failed: ${msg}`);
            return false;
        }
    }

    public async clearAppCache(deviceId: string, packageName: string): Promise<boolean> {
        try {
            await this.client.execAdb(['-s', deviceId, 'shell', 'run-as', packageName, 'rm', '-rf', 'cache', 'code_cache']);
            return true;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(`Clear cache failed: ${msg}`);
            return false;
        }
    }

    public async runDumpsysPackage(deviceId: string, packageName: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'package', packageName], { maxBuffer: 1024 * 1024 * 10 });
    }

    public async runDumpsysMeminfo(deviceId: string, packageName: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'meminfo', packageName], { maxBuffer: 1024 * 1024 * 10 });
    }

    public async runDumpsysActivity(deviceId: string, packageName: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'activity', packageName], { maxBuffer: 1024 * 1024 * 10 });
    }

    public async launchApp(deviceId: string, packageName: string): Promise<boolean> {
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
            return stdout.includes('Events injected');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`Launch failed: ${msg}`);
            return false;
        }
    }
}
