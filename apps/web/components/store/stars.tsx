import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Star rating (read-only). The number is always given as text too, so it never relies on the stars alone. */
export function Stars({ value, size = "sm", className }: { value: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const px = size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3.5";
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className={cn("relative inline-block", px)} aria-hidden>
            <Star className={cn("absolute inset-0 text-border-strong", px)} strokeWidth={1.5} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn("fill-current text-fg", px)} strokeWidth={1.5} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
