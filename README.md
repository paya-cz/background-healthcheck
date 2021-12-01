# background-healthcheck

Node.js package designed to provide healthchecking to containerized background tasks.

# Installation

With [npm](https://www.npmjs.com/) do:

    $ npm install @mangosteen/background-healthcheck

Then, create a file `healthcheck.js`:

```js
import { healthcheck } from '@mangosteen/background-healthcheck';

healthcheck(10000).then(process.exit);
```

The value `10000` is a `staleInterval` param. If you signal heartbeat less often
than `staleInterval`, the container will be reported as unhealthy.

The next step is to configure your `Dockerfile`:

```dockerfile
HEALTHCHECK --interval=15s --retries=3 --timeout=5s \
    CMD ["node", "healthcheck.js"]
```

If you use AWS ECS, then keep in mind [ECS ignores Dockerfile's HEALTHCHECK](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#container_definition_healthcheck). You need to put the healthcheck command in task definition. Similarly,
Kubernetes ignores `Dockerfile`'s `HEALTHCHECK` too, and provides an alternative way to check health. However, you can use our library in either case.

# Usage in your task's code

The healthcheck process checks if the heartbeat has been signaled recently. If you do not signal heartbeat
periodically, the healthcheck will report your container as unhealthy. Pay special attention to async functions
that take a long time to complete.

To begin, create a new `ModuleHeartbeat` instance:

```ts
import { ModuleHeartbeat } from '@mangosteen/background-healthcheck';

const appModule = new ModuleHeartbeat('app', 2000);
```

This creates a new heartbeat module. In this example, the module represents the entire app and we assume this will be the only module you use in the entire app. Alternativaly, if your app has multiple submodules that you would like to healthcheck more granuarly, you can create an arbitrary number of modules in your app. If any module becomes unhealthy, the entire app is considered unhealthy.

The `ModuleHeartbeat` constructor accepts two arguments:
* [`moduleName`] (`string`)  
Optional arbitrary string that identifies the module. Two module instances with the same name are interchangeable.  
`Default: globally-unique randomly generated name (256-bit entropy)`
* [`interval`] (`number`)  
Optional number of milliseconds limiting the frequency at which the heartbeat is reported (to reduce disk I/O).  
`Default: 2000`

To signal a heartbeat, just call the `signal` method of a module:


```ts
for (let i = 0; i < 1000; i++) {
    await insertRowsBatchToDb();
    await appModule.signal();
}
```

If you want to signal a heartbeat during a long-running network request, and you cannot add calls to `signal` at more granular level, you can use `signalWhile` to issue heartbeats periodically:

```ts
const action: PromiseLike<T> = ....

const actionResult: T = await appModule.signalWhile(
    action,
    30000,
);
```

This code will signal heartbeats during the first `30.000ms` or until the `action` promise resolves, whichever happens earlier.

If you are processing streams in a pipeline, you can also signal heartbeat automatically as chunks are processed using `createHeartbeatStream` transform stream:

```ts
import { createHeartbeatStream, ModuleHeartbeat } from '@mangosteen/background-healthcheck';
import stream from 'stream';
import fs from 'fs';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);
const appModule = new ModuleHeartbeat();

(async () => {
    await pipeline(
        fs.createReadStream('./shakespeare.txt'),
        createHeartbeatStream({ heartbeat: appModule }),
        createSinkStream(),
    );
})();

function createSinkStream(): stream.Writable {
    return new stream.Writable({
        highWaterMark: 0,
        write(chunk, _encoding, callback): void {
            callback();
        },
    });
}
```

# What is it good for?

Imagine running a Docker task in AWS Elastic Container Service, on EC2 or Fargate. This task is not a server,
but rather a data retrieval / transformation task. It loads data from some data source (like an API or a DB),
manipulates it in some way (maybe resizes an image?), then writes the result somewhere. Wouldn't it be nice
to still be able to determine if such a container is healthy? That's what this package is for.

# Reference

* Docker [HEALTHCHECK instruction](https://docs.docker.com/engine/reference/builder/#healthcheck)