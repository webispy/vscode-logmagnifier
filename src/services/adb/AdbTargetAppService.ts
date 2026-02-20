import * as vscode from 'vscode';
import { Logger } from '../Logger';
import { AdbClient } from './AdbClient';
import { AdbDevice } from '../../models/AdbModels';

export class AdbTargetAppService {
    private deviceTargetApps: Map<string, string> = new Map(); // deviceId -> packageName
    private launchableAppsCache: Map<string, { packageName: string, componentName: string }[]> = new Map();
    private launchableAppScanPromises: Map<string, Promise<void>> = new Map();
    private connectedDeviceIds: Set<string> = new Set();
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

    public async getLaunchableApps(deviceId: string): Promise<{ packageName: string, componentName: string }[]> {
        const pendingScan = this.launchableAppScanPromises.get(deviceId);
        if (pendingScan) {
            await pendingScan;
        } else if (!this.launchableAppsCache.has(deviceId)) {
            this.startLaunchableAppScan(deviceId);
            const newPendingScan = this.launchableAppScanPromises.get(deviceId);
            if (newPendingScan) {
                await newPendingScan;
            }
        }

        return this.launchableAppsCache.get(deviceId) || [];
    }

    public syncLaunchableAppScans(devices: AdbDevice[]): void {
        const currentConnected = new Set(
            devices
                .filter(device => device.type === 'device')
                .map(device => device.id)
        );

        for (const existingId of Array.from(this.connectedDeviceIds)) {
            if (!currentConnected.has(existingId)) {
                this.connectedDeviceIds.delete(existingId);
                this.launchableAppsCache.delete(existingId);
                this.launchableAppScanPromises.delete(existingId);
            }
        }

        for (const deviceId of currentConnected) {
            if (!this.connectedDeviceIds.has(deviceId)) {
                this.connectedDeviceIds.add(deviceId);
                this.startLaunchableAppScan(deviceId);
            }
        }
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

    public async launchApp(deviceId: string, packageName: string, componentName?: string): Promise<boolean> {
        const component = componentName || await this.resolveLauncherActivity(deviceId, packageName);
        if (component) {
            try {
                const output = await this.client.execAdb(['-s', deviceId, 'shell', 'am', 'start', '-n', component], { maxBuffer: 1024 * 1024 });
                const hasError = output.includes('Error') || output.includes('Exception');
                if (!hasError) {
                    return true;
                }
                this.logger.warn(`[ADB] am start returned error output for ${packageName}: ${output}`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.warn(`[ADB] am start failed for ${packageName}: ${msg}`);
            }
        }

        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
            return stdout.includes('Events injected');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`Launch failed: ${msg}`);
            return false;
        }
    }

    private startLaunchableAppScan(deviceId: string): void {
        if (this.launchableAppScanPromises.has(deviceId)) {
            return;
        }

        const scanPromise = (async () => {
            try {
                this.logger.info(`[ADB] Scanning launcher apps on connect: ${deviceId}`);
                const apps = await this.scanLaunchableApps(deviceId);
                this.launchableAppsCache.set(deviceId, apps);
                this.logger.info(`[ADB] Cached ${apps.length} launcher apps for ${deviceId}`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.warn(`[ADB] Failed to scan launcher apps for ${deviceId}: ${msg}`);
                this.launchableAppsCache.set(deviceId, []);
            }
        })().finally(() => {
            this.launchableAppScanPromises.delete(deviceId);
        });

        this.launchableAppScanPromises.set(deviceId, scanPromise);
    }

    private async scanLaunchableApps(deviceId: string): Promise<{ packageName: string, componentName: string }[]> {
        const packages = await this.getPackagesFromDumpsys(deviceId);
        if (packages.length === 0) {
            return this.queryLauncherComponents(deviceId);
        }

        const launchables = await this.resolveLaunchableComponents(deviceId, packages);
        if (launchables.length > 0) {
            return launchables;
        }

        return this.queryLauncherComponents(deviceId);
    }

    private async queryLauncherComponents(deviceId: string): Promise<{ packageName: string, componentName: string }[]> {
        const tryQuery = async (args: string[]): Promise<string[]> => {
            try {
                const output = await this.client.execAdb(args, { maxBuffer: 1024 * 1024 * 10 });
                return output.split('\n').map(line => line.trim()).filter(Boolean);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.warn(`[ADB] launcher query failed: ${msg}`);
                return [];
            }
        };

        let lines = await tryQuery([
            '-s', deviceId, 'shell', 'cmd', 'package', 'query-intent-activities',
            '-a', 'android.intent.action.MAIN',
            '-c', 'android.intent.category.LAUNCHER',
            '--brief'
        ]);

        if (lines.length === 0) {
            lines = await tryQuery([
                '-s', deviceId, 'shell', 'pm', 'query-intent-activities',
                '-a', 'android.intent.action.MAIN',
                '-c', 'android.intent.category.LAUNCHER',
                '--brief'
            ]);
        }

        const componentMap = new Map<string, string>();
        for (const line of lines) {
            const token = line.split(/\s+/)[0];
            if (!token.includes('/')) {
                continue;
            }

            const [pkgRaw, activityRaw] = token.split('/');
            if (!pkgRaw || !activityRaw) {
                continue;
            }

            const packageName = pkgRaw.trim();
            if (!packageName.includes('.')) {
                continue;
            }

            const activityName = activityRaw.startsWith('.') ? `${packageName}${activityRaw}` : activityRaw;
            const normalizedComponent = `${packageName}/${activityName}`;
            if (!componentMap.has(packageName)) {
                componentMap.set(packageName, normalizedComponent);
            }
        }

        return Array.from(componentMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([packageName, componentName]) => ({ packageName, componentName }));
    }

    private async getPackagesFromDumpsys(deviceId: string): Promise<string[]> {
        try {
            const output = await this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'package', 'packages'], { maxBuffer: 1024 * 1024 * 25 });
            const pkgSet = new Set<string>();
            for (const line of output.split('\n')) {
                const m = line.match(/^\s*Package\s+\[([^\]]+)\]/);
                if (!m) {
                    continue;
                }
                const pkg = m[1].trim();
                if (pkg.includes('.')) {
                    pkgSet.add(pkg);
                }
            }
            return Array.from(pkgSet).sort();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`[ADB] dumpsys package packages failed: ${msg}`);
            return [];
        }
    }

    private async resolveLaunchableComponents(deviceId: string, packages: string[]): Promise<{ packageName: string, componentName: string }[]> {
        const CONCURRENCY = 8;
        const results: { packageName: string, componentName: string }[] = [];
        let cursor = 0;

        const worker = async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= packages.length) {
                    return;
                }

                const packageName = packages[idx];
                const component = await this.resolveLauncherActivity(deviceId, packageName);
                if (component) {
                    results.push({ packageName, componentName: component });
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, packages.length) }, () => worker()));
        results.sort((a, b) => a.packageName.localeCompare(b.packageName));
        return results;
    }

    private async resolveLauncherActivity(deviceId: string, packageName: string): Promise<string | undefined> {
        try {
            const output = await this.client.execAdb([
                '-s', deviceId, 'shell', 'cmd', 'package', 'resolve-activity',
                '--brief',
                '-a', 'android.intent.action.MAIN',
                '-c', 'android.intent.category.LAUNCHER',
                packageName
            ], { maxBuffer: 1024 * 1024 });

            const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
            return lines.find(line => line.includes('/') && line.startsWith(packageName));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`[ADB] resolve-activity failed for ${packageName}: ${msg}`);
            return undefined;
        }
    }
}
