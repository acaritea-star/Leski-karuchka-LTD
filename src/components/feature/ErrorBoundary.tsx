import { Component, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="min-h-screen flex items-center justify-center p-6 bg-background-50">
      <div role="alert" className="max-w-sm text-center">
        <h1 className="text-xl font-bold mb-3">Не успяхме да заредим този екран</h1>
        <p className="mb-5">Обнови страницата. Вече потвърдената поръчка се пази в профила ти.</p>
        <button onClick={()=>window.location.reload()} className="rounded-xl px-6 py-3 bg-primary-600 text-white">Обнови</button>
      </div>
    </main>;
  }
}
