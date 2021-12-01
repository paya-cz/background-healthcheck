import path from 'path';
import { deleteFile, listHeartbeatFiles, readFileJson, writeFileJson } from './lib/fs-utils';
import { ModuleHealthcheckInfo, ModuleHeartbeatInfo } from './lib/models';

interface ModuleFiles {
    baseName: string;
    heartbeatFileName?: string;
    healthcheckFileName?: string;
}

interface ModuleInfo {
    heartbeat?: ModuleHeartbeatInfo;

    healthcheckFileName: string;
    healthcheck?: ModuleHealthcheckInfo;
}

/**
 * Checks if the task is healthy.
 * 
 * A task is healthy if the observed heartbeat value is new, or the value is stale but for at most `staleInterval` milliseconds.
 * 
 * Usage:
 * `healthcheck().then(process.exit);` in your healthcheck.js
 * file (or whatever you invoke via `HEALTHCHECK` docker instruction).
 * 
 * @param staleInterval The number of milliseconds the heartbeat value is allowed to remain unchanged before reporting the container as unhealthy. 
 * @returns Process exit code used to signal the health of the container.
 */
export async function healthcheck(staleInterval = 10000): Promise<number> {
    let result = 0;

    for await (const module of getModuleHealthInfo()) {
        // If a module is unhealthy, the whole app is!
        if (!await isModuleHealthy(module, staleInterval)) {
            console.log(`module unhealthy`, module.healthcheckFileName);
            result = 1;
            // return 1;
        } else {
            console.log('module healthy', module.healthcheckFileName);
        }
    }

    // return 0;
    return result;
}

async function isModuleHealthy(module: ModuleInfo, staleInterval: number): Promise<boolean> {
    const { heartbeat, healthcheck, healthcheckFileName } = module;

    // Missing heartbeat data means the module hasn't been used yet!
    if (heartbeat == null) {
        return true;
    }

    // Healthy if we haven't seen any heartbeats yet, or the heartbeat changed
    if (healthcheck == null || heartbeat.token !== healthcheck.token) {
        await writeModuleHealthcheck(healthcheckFileName, heartbeat.token);
        return true;
    }

    // Healthy if the heartbeat has been stale for at most the specified interval
    if (Date.now() - healthcheck.timestamp < staleInterval) {
        return true;
    }

    // Otherwise, unhealthy
    return false;
}

async function* getModuleHealthInfo(): AsyncGenerator<ModuleInfo, void, void> {
    const fileNames = await listHeartbeatFiles();
    const files = new Map<string, ModuleFiles>();

    for (const name of fileNames) {
        const ext = path.extname(name);
        const basename = path.basename(name, ext);
        const info: ModuleFiles = files.get(basename) ?? { baseName: basename };

        if (ext === '.beat') {
            info.heartbeatFileName = name;
        } else if (ext === '.check') {
            info.healthcheckFileName = name;
        }

        files.set(basename, info);
    }

    for (const f of files.values()) {
        if (f.heartbeatFileName != null) {
            const info: ModuleInfo = {
                healthcheckFileName: `${f.baseName}.check`,
            };

            const [heartbeat, healthcheck] = await Promise.all([
                f.heartbeatFileName != null
                    ? readFileJson<ModuleHeartbeatInfo>(f.heartbeatFileName)
                    : Promise.resolve(undefined),
                f.healthcheckFileName != null
                    ? readFileJson<ModuleHealthcheckInfo>(f.healthcheckFileName)
                    : Promise.resolve(undefined),
            ]);

            info.heartbeat = heartbeat;
            info.healthcheck = healthcheck;
            yield info;
        } else if (f.healthcheckFileName != null) {
            // Clean up abandoned healthcheck file without a matching heartbeat file
            await deleteFile(f.healthcheckFileName);
        }
    }
}

function writeModuleHealthcheck(
    fileName: string,
    token: string,
): Promise<void> {
    const payload: ModuleHealthcheckInfo = {
        token,
        timestamp: Date.now(),
    };

    return writeFileJson(fileName, payload);
}
