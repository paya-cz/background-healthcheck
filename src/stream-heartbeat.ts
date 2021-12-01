import stream from 'stream';
import { HeartbeatService } from './module-heartbeat';

/** Heartbeat stream configuratio options. */
export interface HeartbeatStreamOptions {
    /** Service to use to signal heartbeat. */
    heartbeat: HeartbeatService,

    /** Whether to operate in object mode. */
    objectMode?: boolean,
}

/**
 * Signal heartbeat while data is flowing through the stream.
 * @param options Options to customize the transform stream.
 * @returns Heartbeat transform stream.
 */
export function createHeartbeatStream(
    options: HeartbeatStreamOptions,
): stream.Transform {
    const { heartbeat, objectMode } = options;

    return new stream.Transform({
        allowHalfOpen: false,
        autoDestroy: true,
        decodeStrings: false,
        emitClose: true,
        objectMode: objectMode,

        transform(chunk, encoding, callback): void {
            heartbeat.signal().then(
                () => {
                    this.push(chunk, encoding);
                    callback();
                },
                callback,
            );
        },

        flush(callback): void {
            heartbeat.signal().then(
                () => callback(),
                callback,
            );
        },
    });
}
