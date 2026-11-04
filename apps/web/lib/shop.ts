"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Cart, Shopper } from "./types";

/**
 * Shopper-side data on a store's own domain. Requests go to same-origin /api/storefront/*, so the API resolves the
 * store from the host and the shopper's cookies stay first-party to that store.
 */
export const cartKey = ["cart"] as const;
export const shopperKey = ["shopper"] as const;

export function useCart() {
  return useQuery({ queryKey: cartKey, queryFn: () => api<Cart>("/storefront/cart"), staleTime: 15_000 });
}

/** The signed-in shopper, or null for guests (the API answers 204 when nobody is signed in). */
export function useShopper() {
  return useQuery({
    queryKey: shopperKey,
    queryFn: async () => (await api<Shopper | undefined>("/storefront/account/me")) ?? null,
    staleTime: 60_000,
  });
}

/** Indian states and union territories with their GST state codes (mirrors IndianStates in the API). */
export const INDIAN_STATES: [code: string, name: string][] = [
  ["35", "Andaman and Nicobar Islands"], ["37", "Andhra Pradesh"], ["12", "Arunachal Pradesh"], ["18", "Assam"], ["10", "Bihar"],
  ["04", "Chandigarh"], ["22", "Chhattisgarh"], ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["07", "Delhi"], ["30", "Goa"],
  ["24", "Gujarat"], ["06", "Haryana"], ["02", "Himachal Pradesh"], ["01", "Jammu and Kashmir"], ["20", "Jharkhand"], ["29", "Karnataka"],
  ["32", "Kerala"], ["38", "Ladakh"], ["31", "Lakshadweep"], ["23", "Madhya Pradesh"], ["27", "Maharashtra"], ["14", "Manipur"],
  ["17", "Meghalaya"], ["15", "Mizoram"], ["13", "Nagaland"], ["21", "Odisha"], ["34", "Puducherry"], ["03", "Punjab"], ["08", "Rajasthan"],
  ["11", "Sikkim"], ["33", "Tamil Nadu"], ["36", "Telangana"], ["16", "Tripura"], ["09", "Uttar Pradesh"], ["05", "Uttarakhand"], ["19", "West Bengal"],
];
