import type { ReactNode } from "react";
import { useSfwMode } from "../hooks/useSfwMode";

type SfwGuardProps = {
  children: ReactNode;
};

export function SfwGuard({ children }: SfwGuardProps) {
  const sfwEnabled = useSfwMode();

  if (!sfwEnabled) return <>{children}</>;

  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-900/80">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-700/50 bg-zinc-800/90 px-6 py-4 shadow-lg">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-zinc-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
          />
        </svg>
        <span className="text-sm font-medium text-zinc-400">Safe Mode Enabled</span>
      </div>
    </div>
  );
}
