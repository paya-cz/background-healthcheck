import crypto from 'crypto';
import stream from 'stream';
import envPaths from 'env-paths';
import fs from 'fs/promises';
import path from 'path';
import writeFileAtomic from 'write-file-atomic';

/** Path to the data directory where we store heartbeat info */
const dataDirPath = envPaths('app-container', {
    suffix: '',
}).data;

/** Used to avoid concurrent heartbeats. */
let currentHeartbeat: Promise<void> | undefined;

/**
 * Signal heartbeat to the healthcheck process.
 * Signaling is done by generating a new random heartbeat value.
 */
export async function signalHeartbeat(): Promise<void> {
    if (currentHeartbeat != null) {
        return currentHeartbeat;
    }

    currentHeartbeat = setNewAppHeartbeat();

    try {
        await currentHeartbeat;
    } finally {
        currentHeartbeat = undefined;
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
         * How often to signal heartbeat, in milliseconds.
         * If omitted, will signal heartbeat for each chunk of data.
         */
        interval?: number,
        /** Whether to operate in object mode. */
        objectMode?: boolean,
    },
): stream.Transform {
    let lastNotifyTimestamp: number | undefined = undefined;

    function tick(): Promise<void> {
        const now = Date.now();
        const shouldSignal = options?.interval == null || lastNotifyTimestamp == null || lastNotifyTimestamp + options.interval <= now;

        if (shouldSignal) {
            lastNotifyTimestamp = now;
            return signalHeartbeat();
        } else {
            return Promise.resolve();
        }
    }

    return new stream.Transform({
        allowHalfOpen: false,
        autoDestroy: true,
        decodeStrings: false,
        emitClose: true,
        objectMode: options?.objectMode,

        transform(chunk, encoding, callback): void {
            tick().then(
                () => {
                    this.push(chunk, encoding);
                    callback();
                },
                callback,
            );
        },

        flush(callback): void {
            tick().then(
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
    if (Date.now() - lastSeen.timestamp < staleInterval) {
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

function setNewAppHeartbeat(): Promise<void> {
    return writeFileContent(
        heartbeatFilePath,
        JSON.stringify(<HeartbeatInfo>{
            heartbeat: crypto.randomBytes(16).toString('hex'),
        }),
    );
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
            timestamp: Date.now(),
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