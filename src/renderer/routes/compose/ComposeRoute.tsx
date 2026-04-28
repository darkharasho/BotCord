import { Link } from 'react-router-dom';

export function ComposeRoute() {
  return (
    <div className="min-h-full p-8">
      <Link to="/shell" className="text-sm text-accent hover:underline">← Back to shell</Link>
      <div className="mt-8 max-w-xl">
        <h1 className="text-2xl font-semibold mb-2">Embed composer</h1>
        <p className="text-fg-muted">Coming next session.</p>
      </div>
    </div>
  );
}
