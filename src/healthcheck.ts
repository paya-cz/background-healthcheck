import { listHeartbeatFiles, readFileJson } from './lib/fs-utils';
import { ModuleHeartbeatInfo } from './lib/models';

/**
 * Checks if the task is healthy.
 * 
 * A task is healthy if the observed heartbeat timestamp has been created in the last `staleInterval` milliseconds.
 * 
 * Usage:
 * `healthcheck().then(process.exit);` in your healthcheck.js
 * file (or whatever you invoke via `HEALTHCHECK` docker instruction).
 * 
 * @param staleInterval The number of milliseconds the heartbeat timestamp is allowed to remain unchanged before reporting the container as unhealthy. 
 * @returns Process exit code used to signal the health of the container.
 */
export async function healthcheck(staleInterval = 10000): Promise<number> {
    for (const module of await getModuleHealthInfo()) {
        // Unhealthy if the module timestamp is too old
        if (Date.now() - module.timestamp >= staleInterval) {
            return 1;
        }
    }

    return 0;
}

async function getModuleHealthInfo(): Promise<ModuleHeartbeatInfo[]> {
    // Get an array of heartbeat file names
    const fileNames = await listHeartbeatFiles();

    // Read all the file contents
    const healthInfo = await Promise.all(
        fileNames.map(
            name => readFileJson<ModuleHeartbeatInfo>(name),
        ),
    );

    return healthInfo.reduce<ModuleHeartbeatInfo[]>(
        (arr, info) => info != null ? [...arr, info] : arr,
        [],
    );
}
