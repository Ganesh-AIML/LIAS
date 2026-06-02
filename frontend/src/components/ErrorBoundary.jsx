import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isAdminPage: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn('[ErrorBoundary]', error, info.componentStack);
    this.setState({ isAdminPage: window.location.pathname.startsWith('/admin') });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.isAdminPage) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
          <div className="bg-white border border-slate-200 rounded-2xl p-10 max-w-md text-center shadow-sm">
            <p className="text-xl font-black text-slate-900 mb-2">Admin panel error</p>
            <p className="text-slate-500 text-sm mb-6">Something went wrong. Refresh to retry.</p>
            <button onClick={() => window.location.reload()} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-6 py-2.5 rounded-lg text-sm">
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-10 max-w-md text-center shadow-sm">
          <p className="text-xl font-black text-slate-900 mb-2">Something went wrong</p>
          <p className="text-slate-500 text-sm mb-6">Your answers are saved. Please refresh to continue.</p>
          <button onClick={() => window.location.reload()} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-6 py-2.5 rounded-lg text-sm">
            Refresh Page
          </button>
        </div>
      </div>
    );
  }
}