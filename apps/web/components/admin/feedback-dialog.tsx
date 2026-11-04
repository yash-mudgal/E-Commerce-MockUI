"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { feedbackSchema, type FeedbackInput } from "@/lib/schemas";

const CATEGORIES: [FeedbackInput["category"], string][] = [
  ["Problem", "Something isn't working"], ["Idea", "An idea or request"], ["Question", "A question"], ["Other", "Something else"],
];

/** "Send feedback" from the merchant admin. The ShopMint team triages it in the platform console. */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const path = usePathname();
  const toast = useToast();
  const form = useForm<FeedbackInput>({ resolver: zodResolver(feedbackSchema), defaultValues: { category: undefined, message: "", mayContact: false } });
  const send = useMutation({
    mutationFn: (v: FeedbackInput) => api<{ id: string }>("/admin/feedback", { method: "POST", body: { ...v, page: path.split("?")[0] } }),
    onSuccess: () => {
      toast.notify("Thanks. The ShopMint team reads every message.");
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as keyof FeedbackInput, { message: m });
      toast.notify(errorMessage(e), "error");
    },
  });
  const errors = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Send feedback" description="Tell the ShopMint team what's not working or what you'd like next."
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="feedback-form" disabled={send.isPending}>{send.isPending ? "Sending…" : "Send"}</Button>
      </>}>
      <form id="feedback-form" className="grid gap-4" onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate>
        <fieldset className="grid gap-2" aria-describedby={errors.category ? "feedback-category-error" : undefined}>
          <legend className="mb-1 text-sm font-medium">What is it about?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CATEGORIES.map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" value={v} className="accent-[var(--brand)]" {...form.register("category")} />{l}
              </label>
            ))}
          </div>
          {errors.category && <p id="feedback-category-error" className="text-[13px] text-danger">{errors.category.message}</p>}
        </fieldset>
        <Field label="Message" error={errors.message?.message} hint="Please don't include passwords or card details.">
          <Textarea rows={5} maxLength={2000} {...form.register("message")} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" {...form.register("mayContact")} />
          <span>The ShopMint team may email me about this</span>
        </label>
      </form>
    </Dialog>
  );
}
