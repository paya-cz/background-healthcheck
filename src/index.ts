import crypto from 'crypto';
import envPaths from 'env-paths';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import stream from 'stream';
import writeFileAtomic from 'write-file-atomic';

/** Path to the data directory where we store heartbeat info */
const dataDirPath = envPaths('app-container', {
    suffix: '',
}).data;

/** Used to avoid concurrent heartbeats. */
let currentHeartbeat: Promise<void> | undefined;

/** Used to avoid heartbeats from signaling too often (to minimize I/O). */
let lastHeartbeatTimestamp: number | undefined;

/**
 * Signal heartbeat to the healthcheck process.
 * Signaling is done by generating a new random heartbeat value.
 * @param interval How often to signal heartbeats, in milliseconds. Any heartbeat called within `interval` ms from the last heartbeat will be ignored. If omitted, will always signal heartbeat.
 */
export async function signalHeartbeat(interval?: number): Promise<void> {
    if (interval != null && interval < 0) {
        throw new Error('Parameter "interval" cannot be negative.');
    }
    
    // Ignore heartbeats called more often than `interval`
    const shouldSignal = !interval || lastHeartbeatTimestamp == null || lastHeartbeatTimestamp + interval <= performance.now();

    if (shouldSignal) {
        // Don't issue a new heartbeat if there is a concurrent heartbeat
        if (currentHeartbeat != null) {
            return await currentHeartbeat;
        }

        // Signal heartbeat
        currentHeartbeat = newAppHeartbeat();

        // And wait for it to finish
        try {
            await currentHeartbeat;
        } finally {
            currentHeartbeat = undefined;
        }
    }
}

/**
 * Signal heartbeat while data flows through this transform stream.
 * @param options Specify options to customize the transform stream.
 * @returns Heartbeat transform stream.
 */
export function createHeartbeatStream(
    options?: {
        /**
         * How often to signal heartbeats, in milliseconds.
         * Any heartbeat called within `interval` ms from the last heartbeat will be ignored.
         * If omitted, will signal heartbeat for each chunk of data.
         */
        interval?: number,
        /** Whether to operate in object mode. */
        objectMode?: boolean,
    },
): stream.Transform {
    return new stream.Transform({
        allowHalfOpen: false,
        autoDestroy: true,
        decodeStrings: false,
        emitClose: true,
        objectMode: options?.objectMode,

        transform(chunk, encoding, callback): void {
            signalHeartbeat(options?.interval).then(
                () => {
                    this.push(chunk, encoding);
                    callback();
                },
                callback,
            );
        },

        flush(callback): void {
            signalHeartbeat(options?.interval).then(
                () => callback(),
                callback,
            );
        },
    });
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
    // Get the current and last-seen heartbeats
    const [current, lastSeen] = await Promise.all([
        getAppHeartbeat(),
        getLastSeenHeartbeat(),
    ]);

    // Healthy if we haven't seen any heartbeats yet, or the heartbeat changed
    if (lastSeen == null || current !== lastSeen.heartbeat) {
        await setLastSeenHeartbeat(current);
        return 0;
    }

    // Healthy if the heartbeat has been stale for at most the specified interval
    if (performance.now() - lastSeen.timestamp < staleInterval) {
        return 0;
    }

    // Otherwise, unhealthy
    return 1;
}

//#region App heartbeat

interface HeartbeatInfo {
    heartbeat: string;
}

/** File that stores the latest random value (heartbeat) generated by the app. */
const heartbeatFilePath = path.join(dataDirPath, 'heartbeat.json');

async function newAppHeartbeat(): Promise<void> {
    await writeFileContent(
        heartbeatFilePath,
        JSON.stringify(<HeartbeatInfo>{
            heartbeat: crypto.randomBytes(16).toString('hex'),
        }),
    );
    lastHeartbeatTimestamp = performance.now();
}

async function getAppHeartbeat(): Promise<string> {
    const fileContent = await readFileContent(heartbeatFilePath);

    if (fileContent == null) {
        return 'NONE';
    } else {
        const info: HeartbeatInfo = JSON.parse(fileContent);
        return info.heartbeat;
    }
}

//#endregion

//#region Last seen heartbeat

interface HeartbeatCheck {
    heartbeat: string;
    timestamp: number;
}

/** File stores the app-generated value last-seen by the healthcheck process. */
const lastSeenFilePath = path.join(dataDirPath, 'heartbeat-check.json');

async function getLastSeenHeartbeat(): Promise<HeartbeatCheck | undefined> {
    const fileContent = await readFileContent(lastSeenFilePath);

    if (fileContent == null) {
        return undefined;
    } else {
        return JSON.parse(fileContent) as HeartbeatCheck;
    }
}

function setLastSeenHeartbeat(heartbeat: string): Promise<void> {
    return writeFileContent(
        lastSeenFilePath,
        JSON.stringify(<HeartbeatCheck>{
            heartbeat: heartbeat,
            timestamp: performance.now(),
        }),
    );
}

//#endregion

//#region File utility

async function writeFileContent(filePath: string, content: string): Promise<void> {
    await fs.mkdir(
        path.dirname(filePath),
        { recursive: true, },
    );
    await writeFileAtomic(filePath, content);
}

/** Get file contents. Returns `undefined` if the file doesn't exist. */
async function readFileContent(filePath: string): Promise<string | undefined> {
    try {
        const fileContent = await fs.readFile(filePath);
        return fileContent.toString('utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return undefined;
        } else {
            throw error;
        }
    }
}

//#endregion