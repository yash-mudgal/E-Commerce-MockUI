import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComingSoon } from "@/components/store/coming-soon";
import { RichText } from "@/components/store/rich-text";
import { getPage, getStore } from "@/lib/storefront";

type Params = Promise<{ host: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, slug } = await params;
  const page = await getPage(host, slug);
  if (!page) return { title: "Page not found", robots: { index: false } };
  return { title: page.title, alternates: { canonical: `/pages/${page.slug}` }, description: page.body.replace(/[#*\[\]()_-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) };
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export default function StorePage({ params }: { params: Params }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <Suspense fallback={<div className="h-64 animate-pulse rounded bg-surface-muted" />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: Params }) {
  const { host, slug } = await params;
  const [store, page] = await Promise.all([getStore(host), getPage(host, slug)]);
  if (!store) notFound();
  if (!store.isLive) return <ComingSoon store={store} />;
  if (!page) notFound();
  return (
    <article>
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted"><Link href="/" className="hover:text-fg">Home</Link> <span aria-hidden>/</span> <span className="text-fg">{page.title}</span></nav>
      <h1 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">{page.title}</h1>
      <p className="mt-3 text-xs text-fg-muted">Last updated {dateFmt.format(new Date(page.updatedAt))}</p>
      <div className="mt-10"><RichText source={page.body} /></div>
      {store.supportEmail && (
        <p className="mt-12 border-t border-border pt-6 text-sm text-fg-muted">
          Questions? Write to <a href={`mailto:${store.supportEmail}`} className="font-medium text-fg underline underline-offset-4">{store.supportEmail}</a>.
        </p>
      )}
    </article>
  );
}
