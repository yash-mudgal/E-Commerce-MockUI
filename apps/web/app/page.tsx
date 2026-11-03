import { Boxes, Check, Receipt, Store } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Store, title: "Your own storefront", body: "A fast, mobile-first store on your own subdomain, in your brand colour. Add a custom domain on Pro." },
  { icon: Boxes, title: "Catalogue and stock", body: "Sizes, colours and SKUs with per-variant pricing and stock, low-stock alerts and a full stock ledger." },
  { icon: Receipt, title: "Built for GST", body: "GST-inclusive pricing with HSN codes per product, ready for CGST/SGST and IGST tax invoices." },
];

// Marketing copy. The authoritative plan limits live in the API (Modules/Platform/Plans.cs).
const PLANS = [
  { name: "Basic", price: "₹999", note: "For new sellers", items: ["500 products", "2 staff accounts", "UPI, cards & COD", "GST invoices"] },
  { name: "Pro", price: "₹2,499", note: "For growing D2C brands", items: ["5,000 products", "10 staff accounts", "3 warehouses", "Custom domain"], featured: true },
  { name: "Enterprise", price: "₹7,999", note: "For multi-brand businesses", items: ["Unlimited products", "Unlimited staff", "Unlimited warehouses", "Priority support"] },
];

export default function Landing() {
  return (
    <div className="bg-surface">
      <header className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <span className="flex-1" />
        <Link href="/login" className="text-sm font-medium text-fg-muted hover:text-fg">Sign in</Link>
        <Button asChild size="sm"><Link href="/signup">Start free trial</Link></Button>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
          <p className="text-sm font-medium text-brand">Commerce for Indian brands</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-fg sm:text-6xl">Run your online store without the busywork.</h1>
          <p className="mt-5 max-w-2xl text-lg text-fg-muted">Products, stock, GST and your storefront in one place. Set up in minutes, then spend your time on what you sell.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/signup">Start your 14-day free trial</Link></Button>
            <Button asChild size="lg" variant="secondary"><Link href="/login">Sign in</Link></Button>
          </div>
          <p className="mt-3 text-sm text-fg-subtle">No card required.</p>
        </section>

        <section className="border-y border-border bg-bg">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <div className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand"><Icon className="size-5" aria-hidden /></div>
                <h2 className="mt-4 font-semibold">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="pricing">
          <h2 id="pricing" className="text-2xl font-semibold tracking-tight sm:text-3xl">Simple monthly pricing</h2>
          <p className="mt-2 text-fg-muted">Prices exclude GST. Change or cancel anytime.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={p.featured ? "rounded-[var(--radius-card)] border-2 border-brand p-6" : "rounded-[var(--radius-card)] border border-border p-6"}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.featured && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">Most popular</span>}
                </div>
                <p className="mt-1 text-sm text-fg-muted">{p.note}</p>
                <p className="tabular mt-5"><span className="text-3xl font-semibold">{p.price}</span><span className="text-sm text-fg-muted"> /month</span></p>
                <ul className="mt-5 space-y-2 text-sm">
                  {p.items.map((i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{i}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:justify-between sm:px-6">
          <Logo className="opacity-80" />
          <p>Made in India for Indian brands.</p>
        </div>
      </footer>
    </div>
  );
}
