import { Clock } from "lucide-react";
import type { StorefrontStore } from "@/lib/types";

/** Shown on every storefront page until the merchant launches the store. */
export function ComingSoon({ store }: { store: StorefrontStore }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:py-32">
      <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
        <Clock className="size-6" aria-hidden />
      </span>
      <h1 className="mt-6 font-display text-4xl tracking-tight text-fg sm:text-5xl">{store.name} is opening soon</h1>
      {store.tagline && <p className="mt-3 text-base text-fg-muted sm:text-lg">{store.tagline}</p>}
      <p className="mt-6 text-sm text-fg-muted">
        We&apos;re getting the shelves ready.
        {store.supportEmail && (
          <>
            {" "}Questions? Email{" "}
            <a className="font-medium text-fg underline underline-offset-2" href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a>.
          </>
        )}
      </p>
    </section>
  );
}
