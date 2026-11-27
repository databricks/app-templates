import { ReviewPage } from './pages/review/ReviewPage';

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3">
        <h1 className="text-lg font-semibold">Intelligent Document Review</h1>
      </header>
      <main className="p-6">
        <ReviewPage />
      </main>
    </div>
  );
}
