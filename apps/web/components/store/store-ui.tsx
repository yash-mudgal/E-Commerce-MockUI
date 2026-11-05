"use client";

import * as React from "react";
import type { StorefrontStore } from "@/lib/types";

type Terms = Pick<StorefrontStore, "shippingFee" | "freeShippingThreshold">;
type StoreUI = { cartOpen: boolean; setCartOpen: (open: boolean) => void; terms: Terms | null };

const Ctx = React.createContext<StoreUI>({ cartOpen: false, setCartOpen: () => {}, terms: null });

/** Storefront-wide UI state: the mini cart opens from the header and after "Add to cart". */
export function StoreUIProvider({ terms, children }: { terms: Terms | null; children: React.ReactNode }) {
  const [cartOpen, setCartOpen] = React.useState(false);
  const value = React.useMemo(() => ({ cartOpen, setCartOpen, terms }), [cartOpen, terms]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStoreUI = () => React.useContext(Ctx);
