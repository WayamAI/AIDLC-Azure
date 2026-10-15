import { Component, type ErrorInfo, type ReactNode } from "react";

interface SectionBoundaryProps {
  children?: ReactNode;
  /** Names the section in the console log and the error box. */
  label?: string;
}

interface SectionBoundaryState {
  error: Error | null;
}

/**
 * Contains a render error to one section, so a broken panel, chart or table
 * does not blank the whole page. The error is logged with console.error.
 * It recovers when its parent re-renders with new children.
 */
export class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
  state: SectionBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): SectionBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[Chronos] ${this.props.label ?? "Section"} could not be rendered.`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(previous: SectionBoundaryProps) {
    if (this.state.error && previous.children !== this.props.children) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="m-3 rounded-lg border border-muted bg-raised px-3.5 py-3 text-body-sm text-secondary"
      >
        <p className="font-medium text-primary">This section could not be shown.</p>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-caption text-tertiary">Details</summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-caption text-quaternary">
            {error.message || "Unknown error"}
          </pre>
        </details>
      </div>
    );
  }
}
