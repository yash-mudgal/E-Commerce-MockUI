import type { Metadata } from "next";
import { Suspense } from "react";
import { NewsletterToken } from "@/components/store/newsletter-token";

export const metadata: Metadata = { title: "Newsletter", robots: { index: false } };

export default function NewsletterPage() {
  return <Suspense><NewsletterToken action="unsubscribe" /></Suspense>;
}
