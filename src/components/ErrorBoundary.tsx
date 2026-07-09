"use client";

import { Component } from "react";

export class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) { return { error }; }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 flex items-center justify-center p-8">
          <div className="max-w-lg bg-zinc-900 border border-red-800 rounded-xl p-6">
            <h2 className="text-lg font-bold text-red-400 mb-2">Application Error</h2>
            <pre className="text-sm text-zinc-400 whitespace-pre-wrap break-all font-mono">
              {this.state.error.message}
            </pre>
            <pre className="text-xs text-zinc-500 mt-2 whitespace-pre-wrap break-all font-mono max-h-40 overflow-auto">
              {this.state.error.stack?.slice(0, 600)}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 px-4 py-2 bg-accent text-white text-sm rounded-lg"
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
