import crypto from 'crypto';
import { deleteFile, writeFileJson } from './lib/fs-utils';
import { ModuleHeartbeatInfo } from './lib/models';

export { cleanup } from './lib/fs-utils';

/** Heartbeat service implementation. */
export interface HeartbeatService {
    /** Signal heartbeat to keep the container running. */
    signal(): Promise<void>;
}

/**
 * Heartbeat service for a module.
 * A module can be the entire app, or a more granular task within a single app.
 * The healthcheck will be done across all the modules you have used.
 * To stop a module from being checked, use `stop`.
 */
export class ModuleHeartbeat implements HeartbeatService {
    constructor(
        /**
         * The name of the module.
         * This can be arbitrary `string` used to distinguish different modules in a single app,
         * in case you need to perform healthcheck on a more granular level.
         * You may also use just a single module name for the entire app if you do not need extra granularity.
         */
        readonly moduleName: string,
        /**
         * How often to signal heartbeats, in milliseconds.
         * Any heartbeat signal issued within `interval` ms from the last signal will be ignored (to reduce disk I/O).
         * If omitted, heartbeat will be signaled every time.
         */
        interval?: number,
    ) {
        this.interval = interval;
        this._fileName = `${sha256(moduleName)}.json`;
    }

    private _interval?: number;

    /** Name of the heartbeat file. */
    private readonly _fileName: string;
    
    /** To avoid concurrent heartbeats. */
    private _currentHeartbeat: Promise<void> | undefined;

    /** To avoid heartbeats from signaling too often. */
    private _lastHeartbeatTimestamp: number | undefined;
    
    /**
     * How often to signal heartbeats, in milliseconds.
     * Any heartbeat signal issued within `interval` ms from the last signal will be ignored (to reduce disk I/O).
     * If omitted, heartbeat will be signaled every time.
     */
    get interval(): number | undefined {
        return this._interval;
    }
    set interval(value: number | undefined) {
        if (value != null && value < 0) {
            throw new Error('Heartbeat interval must not be negative.');
        } else if (Number.isNaN(value)) {
            throw new Error('Heartbeat interval must not be NaN.');
        }

        this._interval = value;
    }

    /** Signal heartbeat to the healthcheck process. */
    async signal(): Promise<void> {
        // Ignore heartbeats called more often than `interval`
        const shouldSignal = !this._interval
            || this._lastHeartbeatTimestamp == null
            || this._lastHeartbeatTimestamp + this._interval <= Date.now();
    
        if (shouldSignal) {
            // Don't issue a new heartbeat if there is a concurrent signal
            if (this._currentHeartbeat != null) {
                return await this._currentHeartbeat;
            }
    
            // Signal heartbeat
            this._currentHeartbeat = this._writeHeartbeat();
    
            // And wait for it to finish
            try {
                await this._currentHeartbeat;
            } finally {
                this._currentHeartbeat = undefined;
            }
        }
    }

    /** Stop checking the module health. */
    async stop(): Promise<void> {
        await deleteFile(this._fileName)
    }

    toString(): string {
        return `Heartbeat service for module: ${this.moduleName}`;
    }
    
    private async _writeHeartbeat(): Promise<void> {
        const payload: ModuleHeartbeatInfo = {
            timestamp: Date.now(),
        };

        await writeFileJson(this._fileName, payload);
        this._lastHeartbeatTimestamp = Date.now();
    }
}

function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
