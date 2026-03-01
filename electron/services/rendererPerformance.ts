type RendererPerformanceState = {
  route: string;
  visible: boolean;
  idleSensitive: boolean;
  updatedAt: number;
};

let rendererPerformanceState: RendererPerformanceState = {
  route: "unknown",
  visible: true,
  idleSensitive: false,
  updatedAt: Date.now(),
};

export function getRendererPerformanceState(): RendererPerformanceState {
  return rendererPerformanceState;
}

export function setRendererPerformanceState(
  nextState: Partial<Omit<RendererPerformanceState, "updatedAt">>
): RendererPerformanceState {
  rendererPerformanceState = {
    ...rendererPerformanceState,
    ...nextState,
    updatedAt: Date.now(),
  };

  return rendererPerformanceState;
}

export function shouldDeferBackgroundWork(): boolean {
  return rendererPerformanceState.visible && rendererPerformanceState.idleSensitive;
}
