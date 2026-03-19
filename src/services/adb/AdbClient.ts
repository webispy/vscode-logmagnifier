import * as vscode from 'vscode';
import * as cp from 'child_process';
import { Constants } from '../../Constants';
import { Logger } from '../Logger';

export class AdbClient {
    constructor(private logger: Logger) { }

    public getAdbPath(): string {
        return vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string>(Constants.Configuration.Adb.Path) || Constants.Defaults.AdbPath;
    }

    public async execAdb(args: string[], options?: cp.ExecFileOptions): Promise<string> {
        return new Promise((resolve, reject) => {
            const adbPath = this.getAdbPath();
            cp.execFile(adbPath, args, options, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(`${err.message} (stderr: ${stderr})`));
                    return;
                }
                resolve(stdout.toString());
            });
        });
    }

    public spawnAdb(args: string[], options?: cp.SpawnOptions): cp.ChildProcess {
        const adbPath = this.getAdbPath();
        return cp.spawn(adbPath, args, options || {});
    }

    public async findPid(deviceId: string, search: string): Promise<string | undefined> {
        try {
            const stdout = await this.execAdb(['-s', deviceId, 'shell', 'pidof', '-s', search]);
            if (stdout.trim()) {
                return stdout.trim();
            }
        } catch (e) {
            this.logger.info(`[ADB] pidof not available for ${search}: ${e}`);
        }

        try {
            const stdout = await this.execAdb(['-s', deviceId, 'shell', 'ps', '-A']);
            if (stdout) {
                const pid = this.parsePsForPid(stdout, search);
                if (pid) { return pid; }
            }
        } catch (e) {
            this.logger.info(`[ADB] ps -A not available for ${search}: ${e}`);
        }

        try {
            const stdout = await this.execAdb(['-s', deviceId, 'shell', 'ps']);
            if (stdout) {
                return this.parsePsForPid(stdout, search);
            }
        } catch (e) {
            this.logger.info(`[ADB] ps not available for ${search}: ${e}`);
        }

        return undefined;
    }

    public parsePsForPid(output: string, search: string): string | undefined {
        const lines = output.split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) { continue; }
            const pid = parts[1];
            const name = parts.slice(8).join(' ');
            if (name === search || name.endsWith(`/${search}`)) {
                return pid;
            }
        }
        return undefined;
    }
}
