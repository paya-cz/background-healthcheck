import { ModuleHeartbeat } from './module-heartbeat';

/**
 * Heartbeat service that does nothing.
 * Useful for tests or when you run your app outside of a container.
 */
export class NoopModuleHeartbeat extends ModuleHeartbeat {
    override signal(): Promise<void> {
        return Promise.resolve();
    }

    override async signalWhile<T>(
        action: PromiseLike<T>,
        /** Unused. */
        _timeout?: number,
    ): Promise<T> {
        return await action;
    }

    override sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            setTimeout(resolve, Math.max(ms, 0));
        });
    }

    override stop(): Promise<void> {
        return Promise.resolve();
    }
}

export const NoopHeartbeat = new NoopModuleHeartbeat();