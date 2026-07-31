"use client";

import {
  Activity,
  AlertTriangle,
  Brain,
  ClipboardList,
  FileText,
  HeartPulse,
  Loader2,
  Mic,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CopilotAnalysis = {
  summary: string;
  vitalsAnalysis: string[];
  historyAnalysis: string[];
  riskFlags: string[];
  suggestedQuestions: string[];
};

export type CopilotState = {
  status: "idle" | "loading" | "ready" | "error";
  mode: "loadAnalysis" | "consultAnalysis" | null;
  result: CopilotAnalysis | null;
  error: string;
};

export type ConversationTurn = {
  speaker: "Doctor" | "Patient";
  text: string;
  sourceChunkIndexes: number[];
  confidence: number | null;
};

export type ConversationPanelState = {
  id: string;
  status: "idle" | "recording" | "uploading" | "uploaded" | "transcribing" | "labeling" | "completed" | "failed";
  message: string;
  error: string;
  turns: ConversationTurn[];
  warnings: string[];
  language: string;
  plainTranscript: string;
  audioUrl: string;
  updatedAt: string;
};

type CopilotAppointment = {
  id: string;
};

export function AICopilotPanel({
  appointment,
  copilot,
  conversation,
  onRefresh,
}: {
  appointment?: CopilotAppointment;
  copilot: CopilotState;
  conversation?: ConversationPanelState;
  onRefresh: () => void;
}) {
  const result = copilot.result;

  return (
    <aside className="scrollbar-none h-full w-full min-h-0 min-w-0 overflow-y-auto overscroll-contain">
      <section className="flex h-full min-h-[220px] flex-col rounded-[14px] border bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <PanelTitle icon={Activity} title="AI Copilot" subtitle="Clinical assistance workspace" />
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border bg-white text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!appointment || copilot.status === "loading"}
            onClick={onRefresh}
            type="button"
            aria-label="Refresh AI analysis"
          >
            {copilot.status === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {!appointment ? (
          <div className="mt-3 flex flex-1 items-center justify-center rounded-[12px] border border-dashed bg-[#fbfdff] p-4 text-center">
            <div>
              <Brain className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-xs font-bold text-slate-600">Select a patient</p>
              <p className="mt-1 text-xs leading-4 text-slate-400">Copilot analysis appears when a visit is active.</p>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
            {conversation ? <ConversationTranscriptPanel conversation={conversation} /> : null}

            {copilot.status === "error" ? (
              <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold leading-4 text-amber-800">
                {copilot.error}
              </div>
            ) : null}

            {copilot.status === "loading" && !result ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border bg-[#fbfdff] p-4 text-center">
                <div>
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                <p className="mt-2 text-xs font-bold text-slate-600">Analyzing clinical context</p>
                </div>
              </div>
            ) : null}

            {copilot.status === "idle" && !result ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-dashed bg-[#fbfdff] p-4 text-center">
                <div className="max-w-[270px]">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-blue-50 text-blue-700">
                    <Brain className="h-6 w-6" />
                  </div>
                  <h4 className="mt-3 text-sm font-bold text-slate-800">Review patient context</h4>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">
                    Start a focused AI review of this patient&apos;s history, vitals, visit reason, and missing clinical details.
                  </p>
                  <Button className="mt-4 h-9 rounded-[11px] px-4 text-xs font-bold" onClick={onRefresh} type="button">
                    <Sparkles className="h-3.5 w-3.5" />
                    Start Context Analysis
                  </Button>
                </div>
              </div>
            ) : null}

            {result ? (
              <>
                <div className="rounded-[12px] border bg-white p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-secondary text-primary">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                      {copilot.mode === "consultAnalysis" ? "Consult Analysis" : "Patient Analysis"}
                    </p>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-700">
                    {result.summary || "No summary returned. Review patient details manually."}
                  </p>
                </div>

                <CopilotList icon={HeartPulse} title="Vitals Analysis" items={result.vitalsAnalysis} empty="No vitals signal returned." />
                <CopilotList icon={FileText} title="History Analysis" items={result.historyAnalysis} empty="No history signal returned." />
                <CopilotList
                  icon={AlertTriangle}
                  title="Risk Flags"
                  items={result.riskFlags}
                  empty="No immediate risk flags returned."
                  tone="amber"
                />
                <CopilotList
                  icon={ClipboardList}
                  title="Questions / Tests"
                  items={result.suggestedQuestions}
                  empty="No additional prompts returned."
                  tone="blue"
                />
              </>
            ) : null}
          </div>
        )}
      </section>
    </aside>
  );
}

function ConversationTranscriptPanel({ conversation }: { conversation: ConversationPanelState }) {
  const busy = ["recording", "uploading", "uploaded", "transcribing", "labeling"].includes(conversation.status);
  const completed = conversation.status === "completed" && conversation.turns.length > 0;
  const failed = conversation.status === "failed";

  return (
    <section className="rounded-[12px] border bg-white p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]",
            busy && "bg-blue-50 text-blue-700",
            completed && "bg-emerald-50 text-emerald-700",
            failed && "bg-red-50 text-red-700",
            !busy && !completed && !failed && "bg-slate-100 text-slate-600",
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-bold text-slate-800">Conversation Transcript</h4>
          <p className="truncate text-[11px] font-semibold text-slate-400">Recorded doctor-patient dialogue</p>
        </div>
        <TranscriptStatusBadge conversation={conversation} />
      </div>

      {failed ? (
        <p className="mt-2 rounded-[10px] border border-red-100 bg-red-50 px-2 py-1.5 text-xs font-semibold leading-4 text-red-700">
          {conversation.error || "Conversation transcript failed."}
        </p>
      ) : null}

      {completed ? (
        <div className="mt-2 space-y-1.5">
          {conversation.language ? (
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Language: {conversation.language}
            </p>
          ) : null}
          {conversation.turns.map((turn, index) => (
            <div
              key={`${turn.speaker}-${index}`}
              className={cn(
                "rounded-[10px] border px-2 py-1.5 text-xs leading-4",
                turn.speaker === "Doctor" ? "bg-blue-50/60 text-slate-700" : "bg-emerald-50/60 text-slate-700",
              )}
            >
              <p
                className={cn(
                  "mb-1 text-[10px] font-bold uppercase tracking-[0.12em]",
                  turn.speaker === "Doctor" ? "text-blue-700" : "text-emerald-700",
                )}
              >
                {turn.speaker}
              </p>
              <p>{turn.text}</p>
            </div>
          ))}
          {conversation.warnings.length ? (
            <div className="rounded-[10px] border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs leading-4 text-amber-800">
              {conversation.warnings.join(" ")}
            </div>
          ) : null}
        </div>
      ) : null}

      {!busy && !completed && !failed ? (
        <p className="mt-2 rounded-[10px] border bg-[#fbfdff] px-2 py-1.5 text-xs leading-4 text-slate-400">
          No conversation recording has been completed for this visit.
        </p>
      ) : null}
    </section>
  );
}

function TranscriptStatusBadge({ conversation }: { conversation: ConversationPanelState }) {
  if (conversation.status === "idle") return null;

  const busy = ["recording", "uploading", "uploaded", "transcribing", "labeling"].includes(conversation.status);
  const completed = conversation.status === "completed";
  const failed = conversation.status === "failed";

  return (
    <div
      className={cn(
        "flex h-7 max-w-[138px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-bold",
        busy && "border-blue-100 bg-blue-50 text-blue-700",
        completed && "border-emerald-100 bg-emerald-50 text-emerald-700",
        failed && "border-red-100 bg-red-50 text-red-700",
      )}
      title={conversation.error || conversation.message}
    >
      {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Mic className="h-3 w-3 shrink-0" />}
      <span className="truncate">{conversation.message || transcriptStatusLabel(conversation.status)}</span>
    </div>
  );
}

function transcriptStatusLabel(status: ConversationPanelState["status"]) {
  const labels: Record<ConversationPanelState["status"], string> = {
    idle: "Not started",
    recording: "Recording",
    uploading: "Uploading",
    uploaded: "Uploaded",
    transcribing: "Transcribing",
    labeling: "Preparing transcript",
    completed: "Transcript ready",
    failed: "Transcript failed",
  };

  return labels[status];
}

function CopilotList({
  icon: Icon,
  title,
  items,
  empty,
  tone = "slate",
}: {
  icon: typeof HeartPulse;
  title: string;
  items: string[];
  empty: string;
  tone?: "slate" | "amber" | "blue";
}) {
  return (
    <section className="rounded-[12px] border bg-white p-2.5">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]",
            tone === "slate" && "bg-slate-100 text-slate-600",
            tone === "amber" && "bg-amber-50 text-amber-700",
            tone === "blue" && "bg-blue-50 text-blue-700",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h4 className="min-w-0 truncate text-xs font-bold text-slate-800">{title}</h4>
      </div>
      <div className="mt-2 space-y-1.5">
        {items.length ? (
          items.map((item, index) => (
            <p key={`${title}-${index}`} className="rounded-[10px] border bg-[#fbfdff] px-2 py-1.5 text-xs leading-4 text-slate-600">
              {item}
            </p>
          ))
        ) : (
          <p className="rounded-[10px] border bg-[#fbfdff] px-2 py-1.5 text-xs leading-4 text-slate-400">{empty}</p>
        )}
      </div>
    </section>
  );
}

function PanelTitle({ icon: Icon, title, subtitle }: { icon: typeof HeartPulse; title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold text-slate-800">{title}</h3>
        <p className="truncate text-xs font-medium text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}
