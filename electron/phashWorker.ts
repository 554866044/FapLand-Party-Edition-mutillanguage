import { parentPort } from "node:process";
import { decodeBmpFrame } from "./services/phash/bmp";
import { extractSpriteBmp } from "./services/phash/extract";
import { generateSpritePhashHex } from "./services/phash/phash";

if (!parentPort) {
    console.error("Phash worker started without parentPort.");
    process.exit(1);
}

parentPort.on("message", async (message: unknown) => {
    if (!message || typeof message !== "object") return;

    const { type, taskId, payload } = message as {
        type: string;
        taskId: string;
        payload: {
            ffmpegPath: string;
            videoPath: string;
            range: any;
            options?: { lowPriority?: boolean }
        }
    };

    if (type === "compute-phash") {
        try {
            const { ffmpegPath, videoPath, range, options } = payload;

            const spriteBmp = await extractSpriteBmp(ffmpegPath, videoPath, range, options);
            const sprite = decodeBmpFrame(spriteBmp);
            const phash = generateSpritePhashHex(sprite);

            parentPort!.postMessage({
                type: "phash-result",
                taskId,
                payload: { phash }
            });
        } catch (error) {
            parentPort!.postMessage({
                type: "phash-error",
                taskId,
                payload: {
                    message: error instanceof Error ? error.message : "Unknown worker error",
                    stack: error instanceof Error ? error.stack : undefined
                }
            });
        }
    }
});
