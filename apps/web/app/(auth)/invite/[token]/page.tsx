import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui/display";
import { InviteFlow } from "./invite-flow";

export const metadata: Metadata = { title: "Join a store", referrer: "no-referrer", robots: { index: false } };

type Params = Promise<{ token: string }>;

export default function InvitePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Card className="p-6"><Skeleton className="h-64" /></Card>}>
      <Invite params={params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: Params }) {
  const { token } = await params;
  return <InviteFlow token={token} />;
}
