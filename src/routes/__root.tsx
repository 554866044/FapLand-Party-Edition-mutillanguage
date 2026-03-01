import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalMusicOverlay } from "../components/GlobalMusicOverlay";
import { ControllerProvider } from "../controller";
import { ForegroundMediaProvider } from "../contexts/ForegroundMediaContext";
import { GlobalMusicProvider } from "../contexts/GlobalMusicContext";
import { HandyProvider } from "../contexts/HandyContext";
import { useGlobalParallax } from "../hooks/useGlobalParallax";
import "../styles.css";

const queryClient = new QueryClient();

export const RootComponent: React.FC = () => {
  useGlobalParallax();

  return (
    <QueryClientProvider client={queryClient}>
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
};

export const Route = createRootRoute({
  component: RootComponent,
});
