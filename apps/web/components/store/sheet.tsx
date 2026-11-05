"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** A panel that slides in from the side (menu, mini cart, filters). Focus is trapped and Escape closes it. */
export function Sheet({ open, onOpenChange, side = "right", title, description, children, footer, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; side?: "left" | "right"; title: string; description?: string;
  children: React.ReactNode; footer?: React.ReactNode; className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/40 data-[state=open]:animate-[sf-fade_200ms_ease-out]" />
        <Dialog.Content
          className={cn(
            "storefront fixed inset-y-0 z-50 flex w-[min(26rem,100vw)] flex-col bg-surface text-fg shadow-[var(--shadow-overlay)] focus:outline-none",
            side === "right" ? "right-0 data-[state=open]:animate-[sf-in-right_240ms_ease-out]" : "left-0 data-[state=open]:animate-[sf-in-left_240ms_ease-out]",
            className,
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="font-display text-xl">{title}</Dialog.Title>
            <Dialog.Close className="grid size-9 place-items-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{description ?? title}</Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
