import { CreditCard, FileText, HandCoins, Truck } from "lucide-react";
import { storeTerms, type TermKey } from "@/lib/store-terms";
import type { StorefrontStore } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<TermKey, typeof Truck> = { shipping: Truck, cod: HandCoins, online: CreditCard, invoice: FileText };

/** The store's real shipping and payment terms, as a row (home page) or a list (product page). */
export function TermsList({ store, layout = "row", className }: { store: StorefrontStore; layout?: "row" | "list"; className?: string }) {
  const terms = storeTerms(store);
  return (
    <ul className={cn(layout === "row" ? "grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4" : "space-y-3", className)}>
      {terms.map((t) => {
        const Icon = ICONS[t.key];
        return (
          <li key={t.key} className={cn("flex gap-3", layout === "row" && "flex-col items-center text-center sm:flex-row sm:items-start sm:text-left")}>
            <Icon className={cn("shrink-0 text-fg", layout === "row" ? "size-6" : "mt-0.5 size-5")} strokeWidth={1.5} aria-hidden />
            <div>
              <p className={cn("font-medium", layout === "row" ? "text-sm" : "text-sm")}>{t.title}</p>
              <p className="text-xs text-fg-muted">{t.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
