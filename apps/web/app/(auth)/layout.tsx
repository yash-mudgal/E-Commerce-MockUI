import Link from "next/link";
import { Providers } from "@/components/providers";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col bg-bg">
        <header className="px-5 py-5 sm:px-8">
          <Link href="/" className="inline-flex" aria-label="ShopMint home">
            <Logo />
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
      </div>
    </Providers>
  );
}
