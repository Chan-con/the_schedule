import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep console output for debugging.
    console.error('[ErrorBoundary] Uncaught error:', error);
    console.error('[ErrorBoundary] Component stack:', info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const message =
      (error && typeof error.message === 'string' && error.message) ||
      (typeof error === 'string' ? error : 'Unknown error');

    return (
      <div className="h-screen w-screen overflow-auto bg-white p-6 text-slate-900">
        <div className="text-lg font-semibold">画面の描画中にエラーが発生しました</div>
        <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-800">
          {message}
        </div>
        <div className="mt-4 text-sm text-slate-600">
          ブラウザの開発者ツール（Console）にも詳細ログがあります。
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
