import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type PhashTask = {
    taskId: string;
    payload: {
        ffmpegPath: string;
        videoPath: string;
        range: any;
        options?: { lowPriority?: boolean };
    };
    resolve: (phash: string) => void;
    reject: (error: Error) => void;
};

let worker: UtilityProcess | null = null;
const pendingTasks = new Map<string, PhashTask>();
let taskCounter = 0;

function getWorkerPath(): string {
    // Both dev and prod should have phashWorker.js in the same directory as main.js
    return path.join(__dirname, "phashWorker.js");
}

function ensureWorker(): UtilityProcess {
    if (worker) {
        return worker;
    }

    worker = utilityProcess.fork(getWorkerPath(), [], {
        stdio: "inherit",
        serviceName: "phash-worker"
    });

    worker.on("message", (message: any) => {
        if (!message || typeof message !== "object") return;
        const { type, taskId, payload } = message;

        const task = pendingTasks.get(taskId);
        if (!task) return;

        if (type === "phash-result") {
            pendingTasks.delete(taskId);
            task.resolve(payload.phash);
        } else if (type === "phash-error") {
            pendingTasks.delete(taskId);
            const error = new Error(payload.message);
            error.stack = payload.stack;
            task.reject(error);
        }
    });

    worker.on("exit", (code) => {
        console.log(`Phash worker exited with code ${code}`);
        worker = null;
        // Reject all pending tasks if the worker crashes
        for (const [taskId, task] of pendingTasks.entries()) {
            task.reject(new Error(`Worker exited unexpectedly with code ${code}`));
            pendingTasks.delete(taskId);
        }
    });

    return worker;
}

export async function computePhashInWorker(
    ffmpegPath: string,
    videoPath: string,
    range: any,
    options?: { lowPriority?: boolean }
): Promise<string> {
    const w = ensureWorker();
    const taskId = `${Date.now()}-${taskCounter++}`;

    if (options?.lowPriority && w.pid) {
        try {
            os.setPriority(w.pid, os.constants.priority.PRIORITY_LOW);
        } catch {
            // Best effort
        }
    }

    return new Promise((resolve, reject) => {
        pendingTasks.set(taskId, {
            taskId,
            payload: { ffmpegPath, videoPath, range, options },
            resolve,
            reject,
        });

        w.postMessage({
            type: "compute-phash",
            taskId,
            payload: { ffmpegPath, videoPath, range, options },
        });
    });
}
