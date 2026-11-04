import type { Metadata } from "next";
import { Providers } from "@/components/providers";

export const metadata: Metadata = { title: "Platform console", robots: { index: false } };

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
