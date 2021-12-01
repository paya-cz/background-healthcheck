import crypto from 'crypto';
import { performance } from 'perf_hooks';
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
        this.interval = interval ?? 2000;
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
            || this._lastHeartbeatTimestamp + this._interval <= performance.now();
    
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

    /**
     * Signal heartbeat repeatedly until the specified `action` is resolved. If `timeout` is specified,
     * heartbeat will be signaled only during the first `timeout` milliseconds.
     * 
     * @param action A `Promise` to wait for and keep signaling heartbeat until it is completed.
     * @param timeout The maximum number of milliseconds during which to signal heartbeat.
     * @returns The resolved value of `action`.
     */
    async signalWhile<T>(
        action: PromiseLike<T>,
        timeout?: number,
    ): Promise<T> {
        await this.signal();

        const timeoutObj = Symbol();
        const start = performance.now();

        while (true) {
            // How long to wait before signaling heartbeat
            let waitTime = this._interval ?? 1000;

            // Limit the heartbeat period
            if (timeout != null) {
                const elapsed = performance.now() - start;
                const remaining = timeout - elapsed;

                // If we reached timeout, do not signal heartbeats anymore
                if (remaining <= 0) {
                    return await action;
                }

                waitTime = Math.min(waitTime, remaining);
            }

            let timeoutId!: NodeJS.Timeout;
            const timeoutPromise = new Promise<typeof timeoutObj>(resolve => {
                timeoutId = setTimeout(resolve, waitTime, timeoutObj);
            });

            try {
                const result = await Promise.race([
                    action,
                    timeoutPromise,
                ]);

                await this.signal();

                if (result !== timeoutObj) {
                    return result;
                }
            } finally {
                clearTimeout(timeoutId);
            }
        }
    }

    /**
     * Sleep for the specified number of milliseconds, while signaling heartbeat at the same time.
     * @param ms The number of milliseconds to sleep.
     */
    async sleep(ms: number): Promise<void> {
        await this.signal();

        while (ms > 0) {
            const wait = Math.min(ms, this._interval ?? 1000);
    
            await new Promise(resolve => {
                setTimeout(resolve, wait);
            });

            await this.signal();
    
            ms -= wait;
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
        this._lastHeartbeatTimestamp = performance.now();
    }
}

function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
