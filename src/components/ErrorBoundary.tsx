import React from "react";

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors and chunk-load failures.
 * Shows a friendly fallback with a reload button instead of a blank screen.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  private handleReload = () => {
    // Lazy-chunk load errors usually self-heal after a hard reload.
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center"
        >
          <h1 className="text-xl font-semibold text-foreground">
            Что-то пошло не так
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу — обычно это решает проблему.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
