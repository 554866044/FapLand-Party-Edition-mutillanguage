import "pixi.js/unsafe-eval";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "./styles.css";
import { getRouter } from "./router";
import { refreshStartupBooruMediaCache } from "./services/booru";
import { handleMultiplayerAuthCallback } from "./services/multiplayer";
import { importOpenedFile } from "./services/openedFiles";

const router = getRouter();
const rootElement = document.getElementById("root");

if (!rootElement) {
    throw new Error("Root element not found");
}

void refreshStartupBooruMediaCache();

function registerOpenedFileHandler() {
    if (typeof window === "undefined" || !window.electronAPI?.appOpen) {
        return;
    }

    let queue = Promise.resolve();
    const enqueue = (filePaths: string[]) => {
        queue = queue.then(async () => {
            for (const filePath of filePaths) {
                try {
                    const result = await importOpenedFile(filePath);
                    if (result.kind === "sidecar") {
                        await router.navigate({ to: "/rounds" });
                    } else if (result.kind === "playlist") {
                        await router.navigate({ to: "/playlist-workshop" });
                    }
                } catch (error) {
                    console.error(`Failed to handle opened file: ${filePath}`, error);
                }
            }
        });
    };

    void window.electronAPI.appOpen.consumePendingFiles().then(enqueue).catch((error) => {
        console.error("Failed to consume pending opened files", error);
    });

    window.electronAPI.appOpen.subscribe((filePaths) => {
        enqueue(filePaths);
    });
}

registerOpenedFileHandler();

function registerMultiplayerAuthCallbackHandler() {
    if (typeof window === "undefined" || !window.electronAPI?.auth) {
        return;
    }

    const handleUrl = (url: string | null) => {
        if (!url) return;
        void handleMultiplayerAuthCallback(url).catch((error) => {
            console.error("Failed to process multiplayer auth callback", error);
        });
    };

    void window.electronAPI.auth.consumePendingCallback().then(handleUrl).catch((error) => {
        console.error("Failed to consume pending multiplayer auth callback", error);
    });

    window.electronAPI.auth.subscribe((url) => {
        handleUrl(url);
    });
}

registerMultiplayerAuthCallbackHandler();

createRoot(rootElement).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>
);
