import React from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalMusicOverlay } from "../components/GlobalMusicOverlay";
import { ControllerProvider } from "../controller";
import { ForegroundMediaProvider } from "../contexts/ForegroundMediaContext";
import { GlobalMusicProvider } from "../contexts/GlobalMusicContext";
import { HandyProvider } from "../contexts/HandyContext";
import { useGlobalParallax } from "../hooks/useGlobalParallax";
import "../styles.css";

let queryClient: QueryClient | null = null;

function getQueryClient(): QueryClient {
  if (!queryClient) {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          refetchOnMount: false,
          refetchOnReconnect: false,
          retry: false,
        },
      },
    });
  }
  return queryClient;
}

function RootComponent() {
  useGlobalParallax();

  return (
    <QueryClientProvider client={getQueryClient()}>
      <ControllerProvider>
        <ForegroundMediaProvider>
          <GlobalMusicProvider>
            <HandyProvider>
              <Outlet />
              <GlobalMusicOverlay />
            </HandyProvider>
          </GlobalMusicProvider>
        </ForegroundMediaProvider>
      </ControllerProvider>
    </QueryClientProvider>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
