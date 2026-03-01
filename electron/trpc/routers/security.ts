import * as z from "zod";
import { publicProcedure, router } from "../trpc";
import { addTrustedSite, listTrustedSites, removeTrustedSite, setSecurityMode } from "../../services/security";

export const securityRouter = router({
  listTrustedSites: publicProcedure.query(() => listTrustedSites()),

  setSecurityMode: publicProcedure
    .input(z.object({ mode: z.enum(["prompt", "block", "paranoid"]) }))
    .mutation(({ input }) => ({
      securityMode: setSecurityMode(input.mode),
    })),

  addTrustedSite: publicProcedure
    .input(z.object({ baseDomain: z.string().trim().min(1) }))
    .mutation(({ input }) => ({
      userTrustedBaseDomains: addTrustedSite(input.baseDomain),
    })),

  removeTrustedSite: publicProcedure
    .input(z.object({ baseDomain: z.string().trim().min(1) }))
    .mutation(({ input }) => ({
      userTrustedBaseDomains: removeTrustedSite(input.baseDomain),
    })),
});
