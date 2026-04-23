import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    const error = this.state.error;
    if (!error) return this.props.children;

    return (
      <div className="min-h-dvh w-screen bg-bg text-(--color-ink) grid place-items-center p-6">
        <div
          role="alert"
          className="w-full max-w-130 border border-line-strong bg-paper rounded-md p-5 shadow-xl"
        >
          <div className="font-mono text-[18px] font-semibold tracking-[0.04em]">
            Ident hit a rendering error
          </div>
          <div className="mt-3 font-mono text-[12px] leading-6 text-ink-soft">
            The app shell caught a component crash. You can try rendering again
            or reload the page.
          </div>
          <pre className="mt-4 max-h-40 overflow-auto rounded-sm border border-(--color-line) bg-bg p-3 font-mono text-[11px] text-ink-soft whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="h-8 px-3 rounded-sm border border-(--color-accent) text-(--color-accent) bg-[color-mix(in_oklch,var(--color-accent)_12%,transparent)] font-mono text-[11px] uppercase tracking-[0.08em] cursor-pointer"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-8 px-3 rounded-sm border border-(--color-line) text-(--color-ink) bg-paper-2 font-mono text-[11px] uppercase tracking-[0.08em] cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
