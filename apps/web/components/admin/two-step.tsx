"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ShieldCheck } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { meKey } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

type Status = { enabled: boolean; recoveryCodesLeft: number; enabledAt: string | null };
const key = ["mfa"] as const;

/** The server's message for a specific field (e.g. "That code didn't match…"), else its general message. */
const reason = (e: unknown) => (e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? errorMessage(e) : errorMessage(e));

/**
 * Two-step verification with an authenticator app (TOTP). Turning it on signs out other devices; recovery codes are
 * shown once. Platform operators need it to use the platform console.
 */
export function TwoStepCard({ required }: { required: boolean }) {
  const status = useQuery({ queryKey: key, queryFn: () => api<Status>("/auth/mfa") });
  const [mode, setMode] = React.useState<"setup" | "disable" | "codes" | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const s = status.data;
  return (
    <Card className="lg:col-span-3" id="security">
      <CardHeader title="Two-step verification" description="Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) when you sign in." />
      <div className="space-y-4 p-5 text-sm">
        {!s ? <Skeleton className="h-12" /> : s.enabled ? (
          <>
            <p className="flex flex-wrap items-center gap-2"><Badge tone="success"><ShieldCheck className="size-3" />On</Badge>Since {formatDate(s.enabledAt)} · {s.recoveryCodesLeft} recovery {s.recoveryCodesLeft === 1 ? "code" : "codes"} left</p>
            {s.recoveryCodesLeft <= 3 && <Alert tone="warning">You&apos;re running out of recovery codes. Make new ones.</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setMode("codes")}>New recovery codes</Button>
              <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setMode("disable")}>Turn off</Button>
            </div>
          </>
        ) : (
          <>
            {required && <Alert tone="warning" title="Required for platform tools">Turn this on to use the platform console.</Alert>}
            <p className="text-fg-muted">Off. Anyone with your password can sign in.</p>
            <div><Button size="sm" onClick={() => setMode("setup")}>Turn on</Button></div>
          </>
        )}
      </div>
      {mode === "setup" && <SetupDialog onClose={() => setMode(null)} onCodes={(c) => { setMode(null); setCodes(c); }} />}
      {mode === "disable" && <DisableDialog onClose={() => setMode(null)} />}
      {mode === "codes" && <RegenerateDialog onClose={() => setMode(null)} onCodes={(c) => { setMode(null); setCodes(c); }} />}
      {codes && <CodesDialog codes={codes} onClose={() => setCodes(null)} />}
    </Card>
  );
}

function SetupDialog({ onClose, onCodes }: { onClose: () => void; onCodes: (codes: string[]) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = React.useState("");
  const [qr, setQr] = React.useState<string | null>(null);
  const setup = useQuery({ queryKey: ["mfa-setup"], queryFn: () => api<{ secret: string; uri: string }>("/auth/mfa/setup", { method: "POST" }), staleTime: Infinity, gcTime: 0, retry: false });
  React.useEffect(() => {
    if (setup.data) QRCode.toDataURL(setup.data.uri, { margin: 1, width: 192 }).then(setQr, () => setQr(null));
  }, [setup.data]);
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: { code } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: meKey }); onCodes(r.recoveryCodes); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !enable.isPending && onClose()} title="Turn on two-step verification" className="max-w-lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={enable.isPending}>Cancel</Button><Button loading={enable.isPending} disabled={code.trim().length < 6 || !setup.data} onClick={() => enable.mutate()}>Turn on</Button></>}>
      {setup.isError ? <Alert tone="danger">{errorMessage(setup.error)}</Alert> : !setup.data ? <Skeleton className="h-48" /> : (
        <div className="space-y-4 text-sm">
          <p>1. Scan this with your authenticator app, or enter the key by hand.</p>
          <div className="flex flex-wrap items-center gap-4">
            {qr ? <Image src={qr} alt="QR code for your authenticator app" width={160} height={160} unoptimized className="rounded border border-border" /> : <Skeleton className="size-40" />}
            <div className="min-w-0">
              <p className="text-xs text-fg-muted">Key</p>
              <p className="font-mono text-[13px] break-all" data-testid="mfa-secret">{setup.data.secret.match(/.{1,4}/g)?.join(" ")}</p>
            </div>
          </div>
          <Field label="2. Enter the 6-digit code it shows">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="font-mono tracking-widest" />
          </Field>
          {enable.isError && <Alert tone="danger">{reason(enable.error)}</Alert>}
          <p className="text-xs text-fg-muted">Turning this on signs you out on your other devices.</p>
        </div>
      )}
    </Dialog>
  );
}

function CodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const toast = useToast();
  const text = codes.join("\n");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Save your recovery codes" description="Each code works once if you lose your phone. This is the only time they're shown."
      footer={<Button onClick={onClose}>I&apos;ve saved them</Button>}>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-muted p-3 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.notify("Copied"), () => toast.notify("Couldn't copy", "error"))}><Copy />Copy</Button>
        <Button asChild variant="secondary" size="sm"><a href={`data:text/plain;charset=utf-8,${encodeURIComponent(`ShopMint recovery codes\n\n${text}\n`)}`} download="shopmint-recovery-codes.txt">Download</a></Button>
      </div>
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const off = useMutation({
    mutationFn: () => api("/auth/mfa/disable", { method: "POST", body: { password, code } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: meKey }); toast.notify("Two-step verification turned off"); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !off.isPending && onClose()} title="Turn off two-step verification?" description="Your password alone will sign you in. Other devices are signed out."
      footer={<><Button variant="secondary" onClick={onClose} disabled={off.isPending}>Cancel</Button><Button variant="danger" loading={off.isPending} disabled={!password || code.trim().length < 6} onClick={() => off.mutate()}>Turn off</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Code from your app, or a recovery code"><Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="font-mono" /></Field>
        {off.isError && <Alert tone="danger">{reason(off.error)}</Alert>}
      </div>
    </Dialog>
  );
}

function RegenerateDialog({ onClose, onCodes }: { onClose: () => void; onCodes: (codes: string[]) => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = React.useState("");
  const regen = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body: { password } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: key }); onCodes(r.recoveryCodes); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !regen.isPending && onClose()} title="Make new recovery codes?" description="Your old codes stop working."
      footer={<><Button variant="secondary" onClick={onClose} disabled={regen.isPending}>Cancel</Button><Button loading={regen.isPending} disabled={!password} onClick={() => regen.mutate()}>Make new codes</Button></>}>
      <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {regen.isError && <Alert tone="danger" className="mt-3">{reason(regen.error)}</Alert>}
    </Dialog>
  );
}
