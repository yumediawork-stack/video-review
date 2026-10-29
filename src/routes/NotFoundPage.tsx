import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="vr-card max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Сторінку не знайдено</h1>
        <p className="mt-2 text-sm text-ink-muted">Перевірте адресу або поверніться на головну.</p>
        <Link to="/" className="vr-btn mt-4">
          На головну
        </Link>
      </div>
    </main>
  );
}
