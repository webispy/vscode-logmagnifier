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
}
