/**
 * Loads Razorpay Checkout (checkout.razorpay.com) once, on demand. Used for shoppers' order payments (with the
 * store's key) and for merchants' ShopMint subscriptions (with ShopMint's key). Card and UPI details are entered only
 * in Razorpay's own window, so they never touch ShopMint's servers.
 */
export const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export type RazorpayInstance = { open: () => void; on: (event: string, cb: (r: { error?: { description?: string } }) => void) => void };
declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance }
}

let loader: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = RAZORPAY_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loader = null; reject(new Error("Couldn't load the payment page. Check your connection and try again.")); };
    document.head.appendChild(s);
  });
  return loader;
}
