"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, RefreshCw, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/hooks";
import { inviteSchema, type InviteInput } from "@/lib/schemas";
import type { AssignableRole, Invitation, Me, StaffMember, StaffOverview } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const staffKey = ["staff"] as const;
type Role = Me["role"];

/** Mirrors the API's StaffRules: you manage and grant only roles below your own, never Owner. */
const rank = (r: Role | StaffMember["role"]) => (r === "Owner" ? 3 : r === "Manager" ? 2 : 1);
const grantable = (actor: Role): AssignableRole[] => (["Manager", "Staff"] as const).filter((r) => rank(actor) > rank(r));
const canManage = (actor: Role, target: StaffMember["role"]) => target !== "Owner" && rank(actor) > rank(target);

const ROLE_HELP: Record<AssignableRole, string> = {
  Manager: "Products, inventory, orders, refunds, team members with the Staff role, reports and the activity log. Can't change store settings or billing.",
  Staff: "Products, inventory, orders and fulfilment, and reports. Can't delete products, issue refunds or manage the team.",
};

export default function StaffPage() {
  const me = useMe();
  const allowed = can(me.data, "staff.manage");
  const staff = useQuery({ queryKey: staffKey, queryFn: () => api<StaffOverview>("/admin/staff"), enabled: allowed });
  const [inviting, setInviting] = React.useState(false);

  if (!allowed)
    return (
      <>
        <PageHeader title="Team" />
        <Alert tone="info">Only the store owner and managers can manage the team.</Alert>
      </>
    );

  const seats = staff.data?.seats;
  const full = !!seats && seats.max !== null && seats.used >= seats.max;
  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone who can sign in to manage this store. Each person gets their own login, so the activity log shows who did what."
        actions={<Button onClick={() => setInviting(true)} disabled={!staff.data || full}><UserPlus />Invite</Button>}
      />
      {staff.isPending ? (
        <Card><div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div></Card>
      ) : staff.isError ? (
        <Alert tone="danger" title="Couldn't load your team" action={<Button variant="secondary" size="sm" onClick={() => staff.refetch()}><RefreshCw />Retry</Button>}>
          {errorMessage(staff.error)}
        </Alert>
      ) : (
        <div className="flex flex-col gap-6">
          {seats && seats.max !== null && (
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-fg">{seats.used} of {seats.max}</span> team seats used on your plan (the owner doesn&apos;t take a seat; pending invitations do).
              {full && " Remove someone or revoke an invitation to invite another person."}
            </p>
          )}
          <Members me={me.data!} members={staff.data.members} />
          <Invitations me={me.data!} invitations={staff.data.invitations} />
        </div>
      )}
      <InviteDialog open={inviting} onOpenChange={setInviting} actorRole={me.data!.role} />
    </>
  );
}

function Members({ me, members }: { me: Me; members: StaffMember[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = React.useState<{ kind: "role"; member: StaffMember; role: AssignableRole } | { kind: "remove"; member: StaffMember } | null>(null);

  const action = useMutation({
    mutationFn: async () => {
      if (!pending) return;
      if (pending.kind === "role") await api(`/admin/staff/${pending.member.userId}`, { method: "PATCH", body: { role: pending.role } });
      else await api(`/admin/staff/${pending.member.userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.notify(pending?.kind === "remove" ? `${pending.member.name} was removed` : "Role updated");
      setPending(null);
      qc.invalidateQueries({ queryKey: staffKey });
    },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  return (
    <Card>
      <CardHeader title="Members" description={`${members.length} ${members.length === 1 ? "person" : "people"}`} />
      <Table>
        <thead>
          <tr><Th>Name</Th><Th>Role</Th><Th className="hidden md:table-cell">Last sign-in</Th><Th className="hidden w-0 sm:table-cell"><span className="sr-only">Actions</span></Th></tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const manageable = canManage(me.role, m.role);
            return (
              <tr key={m.userId}>
                <Td>
                  <p className="font-medium text-fg">{m.name}{m.isYou && <span className="ml-1.5 font-normal text-fg-muted">(you)</span>}</p>
                  <p className="text-[13px] break-all text-fg-muted">{m.email}</p>
                  {manageable && (
                    <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-danger sm:hidden" onClick={() => setPending({ kind: "remove", member: m })}>Remove</Button>
                  )}
                </Td>
                <Td>
                  {manageable && grantable(me.role).length > 1 ? (
                    <Select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      onChange={(e) => setPending({ kind: "role", member: m, role: e.target.value as AssignableRole })}
                      className="w-28 sm:w-32"
                    >
                      {grantable(me.role).map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  ) : (
                    <Badge tone={m.role === "Owner" ? "info" : "neutral"}>{m.role}</Badge>
                  )}
                </Td>
                <Td className="hidden text-fg-muted md:table-cell">{m.lastLoginAt ? formatDate(m.lastLoginAt) : "Never"}</Td>
                <Td className="hidden text-right sm:table-cell">
                  {manageable && (
                    <Button variant="ghost" size="sm" onClick={() => setPending({ kind: "remove", member: m })}>Remove</Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Dialog
        open={!!pending}
        onOpenChange={(o) => !o && !action.isPending && setPending(null)}
        title={pending?.kind === "remove" ? `Remove ${pending.member.name}?` : `Make ${pending?.member.name} ${pending?.kind === "role" ? (pending.role === "Manager" ? "a Manager" : "Staff") : ""}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={action.isPending}>Cancel</Button>
            <Button variant={pending?.kind === "remove" ? "danger" : "primary"} loading={action.isPending} onClick={() => action.mutate()}>
              {pending?.kind === "remove" ? "Remove" : "Change role"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          {pending?.kind === "remove"
            ? "They lose access to this store straight away. Their past activity stays in the activity log. You can invite them again later."
            : pending?.kind === "role"
              ? `${ROLE_HELP[pending.role]} They'll be signed out and need to sign in again to pick up the new role.`
              : null}
        </p>
      </Dialog>
    </Card>
  );
}

function Invitations({ me, invitations }: { me: Me; invitations: Invitation[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const resend = useMutation({
    mutationFn: (id: string) => api(`/admin/staff/invitations/${id}/resend`, { method: "POST" }),
    onSuccess: () => { toast.notify("Invitation sent again. The previous link no longer works."); qc.invalidateQueries({ queryKey: staffKey }); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/admin/staff/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.notify("Invitation revoked"); qc.invalidateQueries({ queryKey: staffKey }); },
    onError: (e) => toast.notify(errorMessage(e), "error"),
  });

  return (
    <Card>
      <CardHeader title="Pending invitations" description="Links expire after 7 days." />
      {invitations.length === 0 ? (
        <EmptyState icon={Users} title="No pending invitations" description="Invite people to give them their own login. They'll get an email with a link to join." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Email</Th><Th>Role</Th><Th className="hidden md:table-cell">Invited by</Th><Th className="hidden sm:table-cell">Status</Th><Th className="w-0"><span className="sr-only">Actions</span></Th></tr>
          </thead>
          <tbody>
            {invitations.map((i) => {
              const manageable = grantable(me.role).includes(i.role);
              return (
                <tr key={i.id}>
                  <Td className="break-all">{i.email}</Td>
                  <Td>{i.role}</Td>
                  <Td className="hidden text-fg-muted md:table-cell">{i.invitedBy}</Td>
                  <Td className="hidden sm:table-cell">
                    {i.expired ? <Badge tone="warning">Expired</Badge> : <span className="text-fg-muted">Expires {formatDate(i.expiresAt)}</span>}
                  </Td>
                  <Td>
                    {manageable && (
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <Button variant="ghost" size="sm" loading={resend.isPending && resend.variables === i.id} onClick={() => resend.mutate(i.id)}>
                          <MailPlus />{i.expired ? "Renew" : "Resend"}
                        </Button>
                        <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function InviteDialog({ open, onOpenChange, actorRole }: { open: boolean; onOpenChange: (o: boolean) => void; actorRole: Role }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = grantable(actorRole);
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", role: "Staff" } });
  const [error, setError] = React.useState<string | null>(null);
  const role = useWatch({ control: form.control, name: "role" });

  const close = (o: boolean) => {
    if (!o) { form.reset(); setError(null); }
    onOpenChange(o);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api("/admin/staff/invitations", { method: "POST", body: values });
      toast.notify(`Invitation sent to ${values.email}`);
      qc.invalidateQueries({ queryKey: staffKey });
      close(false);
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof InviteInput, { message: m });
      else setError(errorMessage(e));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Invite a team member"
      description="They'll get an email with a link to join. If they don't have a ShopMint login yet, they'll create one."
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>Send invitation</Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="off" autoFocus {...form.register("email")} />
        </Field>
        <Field label="Role" hint={ROLE_HELP[role]} error={errors.role?.message}>
          <Select {...form.register("role")}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}
