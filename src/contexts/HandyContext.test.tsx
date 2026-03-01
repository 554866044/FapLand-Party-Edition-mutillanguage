import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HandyProvider, useHandy } from "./HandyContext";

const mocks = vi.hoisted(() => ({
  verifyConnection: vi.fn(async () => ({ success: true })),
  issueHandySession: vi.fn(async () => ({
    mode: "appId" as const,
    clientToken: null,
    expiresAtMs: Date.now() + 60_000,
    serverTimeOffsetMs: 0,
    serverTimeOffsetMeasuredAtMs: 0,
    loadedScriptId: null,
    activeScriptId: null,
    lastSyncAtMs: 0,
    lastPlaybackRate: 1,
    maxBufferPoints: 4000,
    streamedPoints: null,
    nextStreamPointIndex: 0,
    tailPointStreamIndex: 0,
    uploadedUntilMs: 0,
    lastHspAddAtMs: 0,
    hspAddBackoffUntilMs: 0,
    hspModeActive: false,
  })),
  stopHandyPlayback: vi.fn(async () => undefined),
  getQuery: vi.fn(async () => null),
  setMutate: vi.fn(async () => undefined),
}));

vi.mock("../services/handyApi", () => ({
  verifyConnection: mocks.verifyConnection,
}));

vi.mock("../services/thehandy/runtime", () => ({
  issueHandySession: mocks.issueHandySession,
  stopHandyPlayback: mocks.stopHandyPlayback,
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.getQuery,
      },
      set: {
        mutate: mocks.setMutate,
      },
    },
  },
}));

function Consumer() {
  const handy = useHandy();

  return (
    <div>
      <div data-testid="connected">{String(handy.connected)}</div>
      <div data-testid="manually-stopped">{String(handy.manuallyStopped)}</div>
      <div data-testid="synced">{String(handy.synced)}</div>
      <button
        type="button"
        onClick={() => {
          void handy.connect("conn-key", "", "app-key");
        }}
      >
        connect
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.forceStop();
        }}
      >
        force-stop
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.toggleManualStop();
        }}
      >
        toggle-stop
      </button>
    </div>
  );
}

describe("HandyContext", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.verifyConnection.mockResolvedValue({ success: true });
    mocks.issueHandySession.mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      serverTimeOffsetMs: 0,
      serverTimeOffsetMeasuredAtMs: 0,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      lastHspAddAtMs: 0,
      hspAddBackoffUntilMs: 0,
      hspModeActive: false,
    });
    mocks.stopHandyPlayback.mockResolvedValue(undefined);
    mocks.getQuery.mockResolvedValue(null);
    mocks.setMutate.mockResolvedValue(undefined);
  });

  it("keeps the connection active but marks TheHandy manually stopped after force stop", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("manually-stopped").textContent).toBe("false");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "force-stop" }));
    });

    await waitFor(() => {
      expect(mocks.issueHandySession).toHaveBeenCalled();
      expect(mocks.stopHandyPlayback).toHaveBeenCalled();
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("manually-stopped").textContent).toBe("true");
      expect(screen.getByTestId("synced").textContent).toBe("false");
    });
  });

  it("keeps manual stop engaged even if the remote stop request fails", async () => {
    mocks.stopHandyPlayback.mockRejectedValueOnce(new Error("stop failed"));

    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("manually-stopped").textContent).toBe("false");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "toggle-stop" }));
    });

    await waitFor(() => {
      expect(mocks.stopHandyPlayback).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("manually-stopped").textContent).toBe("true");
      expect(screen.getByTestId("synced").textContent).toBe("false");
    });
  });

  it("resumes after a manual stop toggle", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "toggle-stop" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manually-stopped").textContent).toBe("true");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "toggle-stop" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manually-stopped").textContent).toBe("false");
      expect(screen.getByTestId("synced").textContent).toBe("false");
    });
  });
});
