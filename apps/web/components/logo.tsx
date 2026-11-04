import { cn } from "@/lib/utils";

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", inverted ? "text-white" : "text-fg", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#4f46e5" />
        <path d="M16 7l8 9-8 9-8-9z" fill="#fff" />
        <path d="M16 7l8 9h-16z" fill="#c7d2fe" />
      </svg>
      <span className="text-[17px]">ShopMint</span>
    </span>
  );
}
