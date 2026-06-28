"use client";

// ============================================================================
// Resizable — thin shadcn-style wrapper over `react-resizable-panels`.
// Used by the app shell to split the CHAT (left) from the live CANVAS (right)
// with a draggable, keyboard-accessible divider. Dark, minimal, Linear-grade:
// the handle is invisible until hover/drag, then a hairline lights up accent.
// ============================================================================

import type { ComponentProps } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";

export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof PanelGroup>) {
  return (
    <PanelGroup
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

export const ResizablePanel = Panel;

export function ResizableHandle({
  withHandle = true,
  className,
  ...props
}: ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) {
  return (
    <PanelResizeHandle
      className={cn(
        "group relative flex w-px items-center justify-center bg-line/70 outline-none transition-colors",
        "data-[resize-handle-state=hover]:bg-accent/60 data-[resize-handle-state=drag]:bg-accent",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <span
          className={cn(
            "z-10 flex h-8 w-3 items-center justify-center rounded-full border border-line bg-panel",
            "opacity-0 transition-opacity duration-200 group-hover:opacity-100",
            "group-data-[resize-handle-state=drag]:opacity-100",
          )}
          aria-hidden
        >
          <svg viewBox="0 0 6 16" fill="none" className="h-3 w-1.5 text-white/40">
            <circle cx="1" cy="3" r="1" fill="currentColor" />
            <circle cx="1" cy="8" r="1" fill="currentColor" />
            <circle cx="1" cy="13" r="1" fill="currentColor" />
            <circle cx="5" cy="3" r="1" fill="currentColor" />
            <circle cx="5" cy="8" r="1" fill="currentColor" />
            <circle cx="5" cy="13" r="1" fill="currentColor" />
          </svg>
        </span>
      )}
    </PanelResizeHandle>
  );
}
