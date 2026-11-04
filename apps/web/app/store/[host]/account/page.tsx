import type { Metadata } from "next";
import { DynamicMarker } from "@/components/store/dynamic-marker";
import { AccountHome } from "./account-home";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default function AccountPage() {
  return (
    <>
      <AccountHome />
      <DynamicMarker />
    </>
  );
}
