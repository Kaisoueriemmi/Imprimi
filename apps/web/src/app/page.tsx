export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">PrintBox</h1>
      <p className="text-slate-600">
        Scannez le QR code affiché sur la borne pour imprimer vos documents.
      </p>
    </main>
  );
}
