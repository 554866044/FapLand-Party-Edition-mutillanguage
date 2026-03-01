import type { ErrorComponentProps } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";

export function DefaultErrorComponent({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[#050508]" />
      <div className="absolute inset-0 bg-gradient-to-br from-red-950/40 via-transparent to-violet-950/30" />

      <div className="relative z-10 mx-4 max-w-lg text-center">
        <div className="mb-6 text-6xl">⚠️</div>
        <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-red-100">
          Something went wrong
        </h1>
        <p className="mb-2 text-sm text-zinc-400">
          An unexpected error occurred while rendering this page.
        </p>
        {error instanceof Error && (
          <p className="mb-6 max-h-24 overflow-auto rounded-lg border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
            {error.message}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-6 py-2.5 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: "/" })}
            className="rounded-xl border border-zinc-600 bg-zinc-800/80 px-6 py-2.5 text-sm font-semibold text-zinc-300 transition-all duration-200 hover:border-zinc-500 hover:bg-zinc-700/80"
          >
            Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}
