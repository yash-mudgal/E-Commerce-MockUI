import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/display";
import { AdminOrder } from "./admin-order";

export const metadata: Metadata = { title: "Order" };

export default function AdminOrderPage() {
  return <Suspense fallback={<Skeleton className="h-96" />}><AdminOrder /></Suspense>;
}
