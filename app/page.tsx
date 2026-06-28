"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import CommandSidebar from "@/components/CommandSidebar";
import ChatPanel from "@/components/ChatPanel";
import CanvasPanel, { type CanvasView } from "@/components/CanvasPanel";
import CommandPalette from "@/components/CommandPalette";
import PanelBoundary from "@/components/ErrorBoundary";
import BlipCompanion from "@/components/blip/BlipCompanion";
import DashboardHome from "@/components/DashboardHome";
import QuickActions from "@/components/QuickActions";
import CommandBar from "@/components/CommandBar";
import { sendMessageRef } from "@/components/chatApi";
import { type Capability, type Intent, spawnsRun } from "@/lib/contract";
import { cn } from "@/lib/utils";

// ============================================================================
// INTERCEPT — the GTM COMMAND CENTER.
//
// Two surfaces, ONE clean left column (CommandSidebar — Blip + the 7 canonical
// tracks + recent chats), switched in place:
//
//   • "dashboard" (the LANDING) — the command center. Live per-track node stat
//     cards + the live agent feed (DashboardHome), the fire-a-play quick-action
//     menu (QuickActions), an editable Target-URL chip (the convex `settings`
//     singleton every play fires against), and the bottom CommandBar.
//
//   • "workspace" — the AI-native chat (ChatPanel) + the live work canvas
//     (CanvasPanel) that follows the conversation / a fired run and renders the
//     boards for whatever capability is in focus. Runs, the dossier Share, and
//     the Brain lens all keep working.
//
// Firing a play (a quick-action card, a dashboard node, or a sidebar track row)
// calls `runs.createRun({ intent, input: targetUrl, inputType: "url",
// trigger: "manual" })` and drills straight into that run's board in the
// workspace. The CommandBar hands free-text to the existing chat router.
// ============================================================================

// Out-of-the-box default if the settings singleton hasn't resolved yet (mirrors
// convex/settings.ts#DEFAULT_TARGET_URL; kept as a literal so we don't import a
// convex server module into the client bundle).
const FALLBACK_TARGET = "nolongerjobless.com";

type Surface = "dashboard" | "workspace";

export default function Home() {
  const [surface, setSurface] = useState<Surface>("dashboard");
  const [conversationId, setConversationId] = useState<Id<"conversations"> | null>(null);
  const [focusedRunId, setFocusedRunId] = useState<Id<"runs"> | null>(null);
  const [activeTrack, setActiveTrack] = useState<Intent | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [canvasView, setCanvasView] = useState<CanvasView>("run");

  // The persisted default target URL (always populated — getSettings seeds it).
  const settings = useQuery(api.settings.getSettings, {});
  const setTargetUrl = useMutation(api.settings.setTargetUrl);
  const targetUrl = settings?.targetUrl ?? "";

  const createRun = useMutation(api.runs.createRun);
  const send = useMutation(sendMessageRef);

  // ── navigation helpers ────────────────────────────────────────────────────
  const goDashboard = useCallback(() => {
    setSurface("dashboard");
    setActiveTrack(null);
    setCanvasView("run");
  }, []);

  const selectConversation = useCallback((id: Id<"conversations">) => {
    setConversationId(id);
    setFocusedRunId(null); // each conversation follows its own latest run
    setActiveTrack(null);
    setCanvasView("run");
    setSurface("workspace");
  }, []);

  const newChat = useCallback(() => {
    setConversationId(null);
    setFocusedRunId(null);
    setActiveTrack(null);
    setCanvasView("run");
    setSurface("workspace");
  }, []);

  const openBrain = useCallback(() => {
    setCanvasView("brain");
    setSurface("workspace");
  }, []);

  // A focused run changed inside the canvas (its mode switcher) — keep the
  // sidebar's active track in sync.
  const focusRun = useCallback((runId: Id<"runs"> | undefined, intent?: string) => {
    setFocusedRunId(runId ?? null);
    if (intent && spawnsRun(intent as Intent)) setActiveTrack(intent as Intent);
  }, []);

  // ── fire a play: one click → a manual run against the default target → drill
  // straight into that track's board in the workspace ───────────────────────
  const fireTrack = useCallback(
    async (intent: Intent) => {
      if (!spawnsRun(intent)) return; // brain/chat never spawn a run
      const input = (targetUrl || FALLBACK_TARGET).trim();
      try {
        const runId = await createRun({
          intent: intent as Capability,
          input,
          inputType: "url",
          trigger: "manual",
        });
        setConversationId(null);
        setFocusedRunId(runId);
        setActiveTrack(intent);
        setCanvasView("run");
        setSurface("workspace");
      } catch {
        /* createRun validates input at the boundary; never break navigation */
      }
    },
    [targetUrl, createRun],
  );

  // Drill into an EXISTING latest run for a track (from a dashboard node).
  const openRun = useCallback((runId: Id<"runs">, intent: Capability) => {
    setConversationId(null);
    setFocusedRunId(runId);
    setActiveTrack(intent);
    setCanvasView("run");
    setSurface("workspace");
  }, []);

  // ── CommandBar → existing chat router (send) ───────────────────────────────
  // Throwing keeps the CommandBar's draft so the user can retry; on success we
  // hand off to the conversation in the workspace.
  const handleCommand = useCallback(
    async (text: string) => {
      const res = await send({ conversationId: conversationId ?? undefined, text });
      if (res?.conversationId) setConversationId(res.conversationId);
      setFocusedRunId(null);
      setActiveTrack(null);
      setCanvasView("run");
      setSurface("workspace");
    },
    [send, conversationId],
  );

  const openPalette = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("intercept:open-command-palette"));
    } catch {
      /* never break the UI */
    }
  }, []);

  return (
    <main className="flex h-[100dvh] w-full overflow-hidden bg-canvas text-ink">
      <PanelBoundary label="Loading the command center…">
        <CommandSidebar
          surface={surface}
          onHome={goDashboard}
          activeId={conversationId}
          onSelectConversation={selectConversation}
          onNewChat={newChat}
          onFireTrack={fireTrack}
          activeTrack={activeTrack}
          brainActive={surface === "workspace" && canvasView === "brain"}
          onOpenBrain={openBrain}
          focusedRunId={focusedRunId}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          onOpenPalette={openPalette}
        />
      </PanelBoundary>

      {surface === "dashboard" ? (
        <DashboardSurface
          targetUrl={targetUrl}
          onSaveTarget={(next) => setTargetUrl({ targetUrl: next })}
          onOpenTrack={fireTrack}
          onOpenRun={openRun}
          onOpenBrain={openBrain}
          onCommand={handleCommand}
        />
      ) : (
        <div className="min-w-0 flex-1">
          <ResizablePanelGroup direction="horizontal" autoSaveId="intercept-split">
            <ResizablePanel defaultSize={38} minSize={28} maxSize={58} className="min-w-0">
              <PanelBoundary label="Starting the chat…">
                <ChatPanel
                  conversationId={conversationId}
                  setConversationId={(id) => setConversationId(id)}
                  focusedRunId={focusedRunId}
                  onFocusRun={focusRun}
                />
              </PanelBoundary>
            </ResizablePanel>

            <ResizableHandle />

            <ResizablePanel defaultSize={62} minSize={42} className="min-w-0">
              <PanelBoundary label="Waking the canvas…">
                <CanvasPanel
                  conversationId={conversationId}
                  focusedRunId={focusedRunId}
                  onFocusRun={focusRun}
                  view={canvasView}
                  onView={setCanvasView}
                />
              </PanelBoundary>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      {/* Blip — a fixed bottom-right companion that lights up on the swarm's
          wins. Pure delight; pointer-events-none except the sprite. */}
      <BlipCompanion
        runId={focusedRunId}
        conversationId={conversationId}
        onFocusRun={focusRun}
        onOpenBrain={openBrain}
      />

      {/* ⌘K command palette — mounted once; owns its own global listener. */}
      <CommandPalette
        conversationId={conversationId}
        canvasView={canvasView}
        sidebarCollapsed={collapsed}
        onConversation={(id) => (id ? selectConversation(id) : newChat())}
        onSetCanvasView={(v) => {
          setCanvasView(v);
          setSurface("workspace");
        }}
        onToggleSidebar={() => setCollapsed((v) => !v)}
      />
    </main>
  );
}

// ----------------------------------------------------------------------------
// DashboardSurface — the LANDING. Editable Target chip on top, the live node
// stat cards + agent feed (DashboardHome) above the fire-a-play quick-action
// menu (QuickActions), and the floating CommandBar pinned to the bottom.
// ----------------------------------------------------------------------------
function DashboardSurface({
  targetUrl,
  onSaveTarget,
  onOpenTrack,
  onOpenRun,
  onOpenBrain,
  onCommand,
}: {
  targetUrl: string;
  onSaveTarget: (next: string) => void | Promise<unknown>;
  onOpenTrack: (intent: Capability) => void;
  onOpenRun: (runId: Id<"runs">, intent: Capability) => void;
  onOpenBrain: () => void;
  onCommand: (text: string) => void | Promise<void>;
}) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-6 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/45">
          INTERCEPT · GTM Command Center
        </p>
        <TargetChip value={targetUrl} onSave={onSaveTarget} />
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* live node stat cards + agent feed */}
        <div className="min-h-0 flex-[1.45] border-b border-hairline">
          <DashboardHome
            onOpenTrack={onOpenTrack}
            onOpenRun={onOpenRun}
            onOpenBrain={onOpenBrain}
          />
        </div>

        {/* fire-a-play quick-action menu */}
        <div className="col-scroll min-h-0 flex-1 overflow-y-auto px-8 pb-28 pt-6">
          <QuickActions onFire={onOpenTrack} targetUrl={targetUrl} />
        </div>

        {/* floating command bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
          <CommandBar targetUrl={targetUrl} onSubmit={onCommand} />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// TargetChip — the editable Target-URL control. Reads the convex `settings`
// singleton (passed in) and persists edits via `settings.setTargetUrl`. Light
// editorial pill; click to edit, Enter / Save to persist, Esc / blur to cancel.
// ----------------------------------------------------------------------------
function TargetChip({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void | Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Keep the draft synced to the persisted value whenever we're not editing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) {
      try {
        await onSave(next);
      } catch {
        /* setTargetUrl never throws for the caller; ignore defensively */
      }
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-pill border border-ink/25 bg-canvas px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
          Target
        </span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={() => void commit()}
          placeholder="example.com"
          spellCheck={false}
          autoComplete="off"
          aria-label="Target business URL"
          className="w-44 bg-transparent font-mono text-[12.5px] text-ink placeholder:text-ink/30 focus:outline-none"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void commit()}
          className="rounded-pill bg-primary px-2 py-0.5 text-[11px] font-fig-link text-on-primary"
        >
          Save
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Edit the default target — every play fires against it"
      className={cn(
        "group inline-flex items-center gap-2 rounded-pill border border-hairline bg-surface-soft px-3 py-1.5",
        "transition-colors hover:border-ink/25 hover:bg-surface-soft",
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
      <span className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
        Target
      </span>
      <span className="font-mono text-[12.5px] text-ink/85">
        {value || FALLBACK_TARGET}
      </span>
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 text-ink/30 transition-colors group-hover:text-ink/55"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}
