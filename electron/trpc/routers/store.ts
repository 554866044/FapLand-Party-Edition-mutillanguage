import * as z from "zod";
import { router, publicProcedure } from "../trpc";
import { getStore } from "../../services/store";
import { getPortableStorageDefault } from "../../services/storagePaths";

export const storeRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    try {
      return getStore().get(input.key);
    } catch (err) {
      console.error("Failed to getStore().get:", err);
      throw err;
    }
  }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.unknown() }))
    .mutation(({ input }) => {
      const store = getStore();
      const resolvedValue = (() => {
        if (input.value === null || input.value === undefined || input.value === "") {
          const portableDefault = getPortableStorageDefault(input.key);
          if (portableDefault) return portableDefault;
        }
        return input.value;
      })();
      store.set(input.key, resolvedValue);
    }),
});
