import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-500">The page you were looking for does not exist.</p>
      <Link to="/" className="text-sm font-medium text-slate-700 underline">
        Back to rules
      </Link>
    </div>
  );
}
