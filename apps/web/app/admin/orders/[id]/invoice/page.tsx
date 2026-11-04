import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/display";
import { AdminInvoice } from "./admin-invoice";

export const metadata: Metadata = { title: "Invoice" };

export default function AdminInvoicePage() {
  return <Suspense fallback={<Skeleton className="h-96" />}><AdminInvoice /></Suspense>;
}
