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

And configure your `Dockerfile`:

```dockerfile
HEALTHCHECK --interval=15s --retries=3 --timeout=5s \
    CMD ["node", "healthcheck.js"]
```

If you use AWS ECS, then keep in mind [ECS ignores Dockerfile's HEALTHCHECK](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#container_definition_healthcheck). You need to put the healthcheck command in task definition. Similarly,
Kubernetes ignores `Dockerfile`'s `HEALTHCHECK` too, and provides an alternative way to check health. However, you can use our library in either case.

# Usage in your task's code

The healthcheck process checks if the heartbeat has been signaled recently. If you do not
call the `signalHeartbeat` periodically, the healthcheck will report your container as
unhealthy. Pay special attention to async functions that take a long time to complete.

You can customize the heartbeat period using `staleInterval` param of the `healthcheck` function.
If you signal heartbeat less often than `staleInterval`, the container will be unhealthy.

```js
import { signalHeartbeat } from '@mangosteen/background-healthcheck';

for (let i = 0; i < 1000; i++) {
    await insertRowsBatchToDb();
    await signalHeartbeat();
}
```

If you are processing streams in a pipeline, you can also signal heartbeat automatically
as chunks are processed using `createHeartbeatStream` transform stream:

```js
import { createHeartbeatStream } from '@mangosteen/background-healthcheck';
import stream from 'stream';
import fs from 'fs';
import { promisify } from 'util';
const pipeline = promisify(stream.pipeline);

(async () => {
    await pipeline(
        fs.createReadStream('./shakespeare.txt'),
        createHeartbeatStream({ interval: 2000 }),
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