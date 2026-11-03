"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Accessible modal (focus trap, Escape, aria) built on Radix. Use for quick actions only; complex editing gets a full page. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-950/40 data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-overlay)] focus:outline-none",
            className,
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description>}
            </div>
            <D.Close className="-m-1 rounded-md p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
