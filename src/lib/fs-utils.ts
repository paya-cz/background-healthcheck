import envPaths from 'env-paths';
import fs from 'fs';
import path from 'path';
// import process from 'process';
import writeFileAtomic from 'write-file-atomic';

/** Path to the data directory where we store heartbeat info */
const dataDirPath = envPaths('heartbeat-820d15cef9ae45b794b91c30dc1d9cce', {
    suffix: '',
}).data;

export async function listHeartbeatFiles() {
    const files = await fs.promises.readdir(dataDirPath, {
        withFileTypes: true,
    });

    return files
        .filter(f => f.isFile())
        .map(f => f.name);
}

export async function writeFileJson(
    fileName: string,
    content: any,
): Promise<void> {
    const filePath = path.join(dataDirPath, fileName);

    await fs.promises.mkdir(
        path.dirname(filePath),
        { recursive: true, },
    );

    await writeFileAtomic(
        filePath,
        JSON.stringify(content),
    );
}

/** Get file contents. Returns `undefined` if the file doesn't exist. */
export async function readFileJson<T extends {}>(
    fileName: string,
): Promise<T | undefined> {
    const filePath = path.join(dataDirPath, fileName);

    try {
        const fileContent = await fs.promises.readFile(filePath);
        const contentString = fileContent.toString('utf8');
        return JSON.parse(contentString);
    } catch (error) {
        if ((error as any)?.code === 'ENOENT') {
            return undefined;
        } else {
            throw error;
        }
    }
}

export async function deleteFile(
    fileName: string,
): Promise<void> {
    const filePath = path.join(dataDirPath, fileName);

    await fs.promises.rm(filePath, {
        force: true,
    });
}
