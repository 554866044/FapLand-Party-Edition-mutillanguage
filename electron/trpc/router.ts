import { router } from "./trpc";
import { dbRouter } from "./routers/db";
import { storeRouter } from "./routers/store";
import { phashRouter } from "./routers/phash";
import { booruRouter } from "./routers/booru";
import { playlistRouter } from "./routers/playlist";
import { integrationRouter } from "./routers/integration";
import { converterRouter } from "./routers/converter";
import { machineIdRouter } from "./routers/machineId";
import { mediaRouter } from "./routers/media";
import { updaterRouter } from "./routers/updater";
import { securityRouter } from "./routers/security";

export const appRouter = router({
    db: dbRouter,
    store: storeRouter,
    phash: phashRouter,
    booru: booruRouter,
    playlist: playlistRouter,
    integration: integrationRouter,
    converter: converterRouter,
    machineId: machineIdRouter,
    media: mediaRouter,
    updater: updaterRouter,
    security: securityRouter,
});

export type AppRouter = typeof appRouter;
