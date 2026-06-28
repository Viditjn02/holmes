"use client";

import { Component, type ReactNode } from "react";

// ============================================================================
// PanelBoundary — keeps one panel's failure from white-screening the app. A
// Convex `useQuery` against a function that isn't deployed yet (e.g. during a
// staged rollout) throws during render; this catches it and shows a calm,
// retryable fallback so the rest of the surface stays alive.
// ============================================================================

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
}

export default class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-full place-items-center p-8">
          <div className="max-w-xs text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-surface-soft text-ink/40">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <p className="mt-3 text-[13px] font-medium text-ink/70">
              {this.props.label ?? "Connecting to the live backend…"}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink/45">
              This panel comes online the moment its Convex functions are deployed.
            </p>
            <button
              onClick={this.reset}
              className="mt-4 rounded-lg border border-hairline bg-surface-soft px-3 py-1.5 text-[12px] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
