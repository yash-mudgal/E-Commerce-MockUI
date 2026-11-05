import Link from "next/link";

export default function StoreNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="text-sm font-medium text-fg-muted">404</p>
      <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">We couldn&apos;t find that</h1>
      <p className="mt-2 text-sm text-fg-muted">The page or store you&apos;re looking for doesn&apos;t exist or is temporarily unavailable.</p>
      <Link href="/" className="mt-6 text-sm font-medium text-brand hover:underline">Go to the home page</Link>
    </div>
  );
}
