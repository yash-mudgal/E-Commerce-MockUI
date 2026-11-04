import { connection } from "next/server";
import { Suspense } from "react";

async function Connection() {
  await connection();
  return null;
}

/**
 * Marks a storefront page as intentionally rendered per request. Store pages take their title and robots rules from
 * the store (resolved from the host), so their metadata can't be part of a build-time shell. Renders nothing.
 */
export function DynamicMarker() {
  return (
    <Suspense>
      <Connection />
    </Suspense>
  );
}
