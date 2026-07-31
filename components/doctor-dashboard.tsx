"use client";

import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  ClipboardList,
  Download,
  FlaskConical,
  FileText,
  HeartPulse,
  Image as ImageIcon,
  Loader2,
  Mic,
  Pill,
  Plus,
  QrCode,
  Search,
  ScanLine,
  Stethoscope,
  Square,
  Timer,
  Trash2,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AICopilotPanel as ClinicalAICopilotPanel,
  type ConversationPanelState,
  type CopilotAnalysis,
  type CopilotState,
} from "@/components/ai-copilot-panel";
import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { visitConversationRecordingEnabled } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

type AppointmentStatus = "CONFIRMED" | "WAITING" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
type AppointmentVisitType = "INITIAL" | "FOLLOW_UP";
type Gender = "FEMALE" | "MALE" | "OTHER";

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
    };
  }
}

type Doctor = {
  id: string;
  name: string;
  specialty: string;
  department: string;
};

type HistoryEntry = {
  id: string;
  title: string;
  detail: string;
  recordedAt: string;
};

type Prescription = {
  id?: string;
  medicine: string;
  dosage: string;
  route: string;
  frequency: string;
  timing: string;
  mealTiming: string;
  duration: string;
  quantity: string;
  instructions: string;
};

type TestObservation = {
  name?: string;
  value?: string;
  unit?: string;
  referenceRange?: string;
  flag?: string;
  interpretation?: string;
  confidence?: number | null;
};

type ClinicalTestResult = {
  id: string;
  testName: string;
  reportTitle: string;
  labName: string;
  specimen: string;
  collectedAtText: string;
  reportedAtText: string;
  overallImpression: string;
  rawText: string;
  observations: TestObservation[];
  panels: unknown[];
  extractionWarnings: string[];
  extractionStatus: "PENDING" | "COMPLETED" | "FAILED";
  extractionError: string;
  modelName: string;
  extractedAt: string | null;
  createdAt: string;
  images: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    imageUrl: string;
  }[];
};

type ClinicalRecord = {
  id: string;
  diagnosis: string;
  observations: string;
  followUpNotes: string;
  diagnosisAiDraft: string;
  observationsAiDraft: string;
  followUpNotesAiDraft: string;
  clinicalNotesGenerationStatus: ClinicalNotesGenerationStatus;
  clinicalNotesGenerationError: string;
  clinicalNotesModelName: string;
  clinicalNotesGeneratedAt: string | null;
  clinicalNotesDraftVersion: string;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number;
  vitals: {
    bloodPressure: string;
    pulse: string;
    temperature: string;
    spo2: string;
    weight: string;
  };
  prescriptions: Prescription[];
  testResults: ClinicalTestResult[];
};

type StoredAiAnalysis = CopilotAnalysis & {
  id: string;
  mode: "loadAnalysis" | "consultAnalysis";
  modelName: string;
  generatedAt: string;
  updatedAt: string;
};

type DoctorAppointment = {
  id: string;
  bookingCode: string;
  visitReason: string;
  visitType: AppointmentVisitType;
  followUpFromId: string | null;
  status: AppointmentStatus;
  notes: string | null;
  doctor: Doctor;
  patient: {
    id: string;
    name: string;
    phone: string;
    age: number;
    gender: Gender;
    medicalHistory: HistoryEntry[];
  };
  slot: {
    id: string;
    startsAt: string;
  };
  clinicalRecord: ClinicalRecord | null;
  aiAnalysis: StoredAiAnalysis | null;
};

type DashboardData = {
  doctor: Doctor | null;
  appointments: DoctorAppointment[];
};

const blankPrescription: Prescription = {
  medicine: "",
  dosage: "",
  route: "",
  frequency: "",
  timing: "",
  mealTiming: "",
  duration: "",
  quantity: "",
  instructions: "",
};

const routeOptions = ["Oral", "Topical", "Inhalation", "Nasal", "Eye drops", "Ear drops", "Injection", "Sublingual"];
const timingOptions = [
  "Morning",
  "Afternoon",
  "Evening",
  "Night",
  "Morning + Afternoon",
  "Morning + Evening",
  "Morning + Night",
  "Afternoon + Evening",
  "Afternoon + Night",
  "Evening + Night",
  "Morning + Afternoon + Evening",
  "Morning + Afternoon + Night",
  "Morning + Evening + Night",
  "Afternoon + Evening + Night",
  "Morning + Afternoon + Evening + Night",
  "Every 6 hours",
  "Every 8 hours",
  "Every 12 hours",
  "As needed",
  "Before sleep",
  "SOS",
];
const mealTimingOptions = ["After food", "Before food", "With food", "Empty stomach", "Any time", "After breakfast", "After dinner"];
const doctorSlotPeriods = [
  { id: "morning", label: "Morning", startHour: 9, startMinute: 0, endHour: 12, endMinute: 0 },
  { id: "afternoon", label: "Afternoon", startHour: 12, startMinute: 0, endHour: 14, endMinute: 0 },
  { id: "evening", label: "Evening", startHour: 19, startMinute: 0, endHour: 21, endMinute: 0 },
];

const blankForm = {
  diagnosis: "",
  observations: "",
  followUpNotes: "",
  vitals: {
    bloodPressure: "",
    pulse: "",
    temperature: "",
    spo2: "",
    weight: "",
  },
  prescriptions: [{ ...blankPrescription }],
};

const blankCopilotState: CopilotState = {
  status: "idle",
  mode: null,
  result: null,
  error: "",
};

type ClinicalNoteField = "diagnosis" | "observations" | "followUpNotes";
type ClinicalNotesGenerationStatus = "IDLE" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

type ClinicalNotesSnapshot = {
  diagnosis: string;
  observations: string;
  followUpNotes: string;
  unverified: Record<ClinicalNoteField, boolean>;
  generationStatus: ClinicalNotesGenerationStatus;
  generationError: string;
  generatedAt: string | null;
  draftVersion: string;
};

type ClinicalNoteSaveStatus = "idle" | "saving" | "saved" | "error";

const blankConversationState: ConversationPanelState = {
  id: "",
  status: "idle",
  message: "",
  error: "",
  turns: [],
  warnings: [],
  language: "",
  plainTranscript: "",
  audioUrl: "",
  updatedAt: "",
};

const blankClinicalNotesSnapshot: ClinicalNotesSnapshot = {
  diagnosis: "",
  observations: "",
  followUpNotes: "",
  unverified: {
    diagnosis: false,
    observations: false,
    followUpNotes: false,
  },
  generationStatus: "IDLE",
  generationError: "",
  generatedAt: null,
  draftVersion: "",
};

type RecordedConversation = {
  appointmentId: string;
  bookingCode: string;
  startedAt: string;
  mimeType: string;
  chunks: Blob[];
  recording: Blob;
};

type VisitConversationApiResponse = {
  conversation: {
    id: string;
    bookingCode: string;
    attemptLabel: string;
    status: "UPLOADED" | "TRANSCRIBING" | "LABELING" | "COMPLETED" | "FAILED";
    errorMessage: string;
    durationSeconds: number;
    language: string;
    plainTranscript: string;
    audioUrl: string;
    turns: {
      speaker: "Doctor" | "Patient";
      text: string;
      sourceChunkIndexes: number[];
      confidence: number | null;
    }[];
    warnings: string[];
    updatedAt: string;
  } | null;
  clinicalNotes: ClinicalNotesSnapshot | null;
};

type HistoryConversationDialogState = {
  appointmentId: string;
  bookingCode: string;
  patientName: string;
  historyTitle: string;
};

type DashboardAlert = {
  id: number;
  message: string;
  tone: "success" | "error";
};

type PendingTestDelete = {
  id: string;
  name: string;
  imageCount: number;
};

type AddPatientSlot = {
  startsAt: string;
};

type AddPatientForm = {
  name: string;
  age: string;
  gender: "" | "FEMALE" | "MALE" | "OTHER";
  phone: string;
  visitReason: string;
};

type QrScanResult = Pick<DoctorAppointment, "id" | "bookingCode" | "visitReason" | "status" | "patient" | "slot" | "doctor">;

type QrScannerState = {
  open: boolean;
  status: "idle" | "scanning" | "success" | "error";
  message: string;
  result: QrScanResult | null;
};

const blankAddPatientForm: AddPatientForm = {
  name: "",
  age: "",
  gender: "",
  phone: "",
  visitReason: "",
};

const dictationMaxDurationSeconds = 30;
const conversationChunkMilliseconds = 60_000;

const blankQrScannerState: QrScannerState = {
  open: false,
  status: "idle",
  message: "",
  result: null,
};

type DictationTarget = {
  appointmentId?: string;
  doctorId?: string;
};

export function DoctorDashboard({ doctorId }: { doctorId: string }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData>({ doctor: null, appointments: [] });
  const [activeAppointmentId, setActiveAppointmentId] = useState("");
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState(() => getTodayDateKey());
  const [form, setForm] = useState(blankForm);
  const [historyForm, setHistoryForm] = useState({
    title: "",
    detail: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingVitals, setSavingVitals] = useState(false);
  const [savingTestResult, setSavingTestResult] = useState(false);
  const [deletingTestId, setDeletingTestId] = useState("");
  const [pendingTestDelete, setPendingTestDelete] = useState<PendingTestDelete | null>(null);
  const [addPatientSlot, setAddPatientSlot] = useState<AddPatientSlot | null>(null);
  const [addPatientForm, setAddPatientForm] = useState<AddPatientForm>(blankAddPatientForm);
  const [savingAddedPatient, setSavingAddedPatient] = useState(false);
  const [testResultForm, setTestResultForm] = useState({ testName: "" });
  const [dashboardAlert, setDashboardAlert] = useState<DashboardAlert | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copilotByAppointment, setCopilotByAppointment] = useState<Record<string, CopilotState>>({});
  const [conversationByAppointment, setConversationByAppointment] = useState<Record<string, ConversationPanelState>>({});
  const [clinicalNotesByAppointment, setClinicalNotesByAppointment] = useState<Record<string, ClinicalNotesSnapshot>>({});
  const [clinicalNoteSaveStatus, setClinicalNoteSaveStatus] = useState<Record<ClinicalNoteField, ClinicalNoteSaveStatus>>({
    diagnosis: "idle",
    observations: "idle",
    followUpNotes: "idle",
  });
  const [historyConversationDialog, setHistoryConversationDialog] = useState<HistoryConversationDialogState | null>(null);
  const [qrScanner, setQrScanner] = useState<QrScannerState>(blankQrScannerState);
  const conversationRecorderRef = useRef<MediaRecorder | null>(null);
  const conversationStreamRef = useRef<MediaStream | null>(null);
  const conversationChunksRef = useRef<Blob[]>([]);
  const activeConversationRef = useRef<{ appointmentId: string; bookingCode: string; startedAt: string; mimeType: string } | null>(
    null,
  );
  const conversationStopResolverRef = useRef<((recording: RecordedConversation | null) => void) | null>(null);
  const conversationPollTimersRef = useRef<Record<string, number>>({});
  const clinicalNoteSaveTimersRef = useRef<Partial<Record<ClinicalNoteField, number>>>({});
  const clinicalNoteEditSequenceRef = useRef<Record<ClinicalNoteField, number>>({
    diagnosis: 0,
    observations: 0,
    followUpNotes: 0,
  });
  const clinicalNoteDraftVersionRef = useRef<Partial<Record<ClinicalNoteField, string>>>({});
  const clinicalNoteDirtyRef = useRef<Record<ClinicalNoteField, boolean>>({
    diagnosis: false,
    observations: false,
    followUpNotes: false,
  });
  const pendingClinicalNoteValueRef = useRef<Partial<Record<ClinicalNoteField, string>>>({});

  useEffect(() => {
    let mounted = true;

    async function loadInitialDashboard() {
      try {
        const response = await fetch(`/api/doctor-dashboard?doctorId=${encodeURIComponent(doctorId)}`);
        if (response.status === 401 || response.status === 404) {
          router.replace("/doctor");
          return;
        }
        if (!response.ok) {
          throw new Error("Dashboard request failed");
        }
        const nextData = (await response.json()) as DashboardData;
        const todayKey = getTodayDateKey();
        const nextAppointment = filterAppointments(nextData.appointments, todayKey, "")[0];

        if (!mounted) return;
        setData(nextData);
        setCopilotByAppointment((current) => hydrateCopilotStates(nextData.appointments, current));
        setClinicalNotesByAppointment(hydrateClinicalNotes(nextData.appointments));
        if (nextAppointment) {
          setActiveAppointmentId(nextAppointment.id);
          setForm(fromRecord(nextAppointment.clinicalRecord));
        }
      } catch {
        if (mounted) {
          showAlert("Could not load doctor dashboard. Check database seed and refresh.", "error");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadInitialDashboard();

    return () => {
      mounted = false;
    };
  }, [doctorId, router]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!dashboardAlert) return;
    const timeout = window.setTimeout(() => setDashboardAlert(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [dashboardAlert]);

  const visibleAppointments = useMemo(
    () => filterAppointments(data.appointments, dateFilter, query),
    [data.appointments, dateFilter, query],
  );

  const dateOptions = useMemo(() => getAppointmentDates(data.appointments), [data.appointments]);

  const activeAppointment =
    visibleAppointments.find((appointment) => appointment.id === activeAppointmentId) ?? visibleAppointments[0];
  const patientVisits = useMemo(
    () =>
      activeAppointment
        ? getPatientVisits(data.appointments, activeAppointment.patient.id)
        : [],
    [activeAppointment, data.appointments],
  );
  const activeCopilot = activeAppointment ? copilotByAppointment[activeAppointment.id] ?? blankCopilotState : blankCopilotState;
  const activeConversation = activeAppointment
    ? conversationByAppointment[activeAppointment.id] ?? blankConversationState
    : blankConversationState;
  const activeClinicalNotes = activeAppointment
    ? clinicalNotesByAppointment[activeAppointment.id] ?? snapshotFromRecord(activeAppointment.clinicalRecord)
    : blankClinicalNotesSnapshot;

  useEffect(() => {
    return () => {
      stopConversationTracks();
      Object.values(conversationPollTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      conversationPollTimersRef.current = {};
      Object.values(clinicalNoteSaveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      clinicalNoteSaveTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!visitConversationRecordingEnabled) return;

    const shouldWarn = Object.values(conversationByAppointment).some((conversation) =>
      ["recording", "uploading"].includes(conversation.status),
    );

    if (!shouldWarn) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [conversationByAppointment]);

  useEffect(() => {
    if (!visitConversationRecordingEnabled) return;
    if (!activeAppointment) return;
    const current = conversationByAppointment[activeAppointment.id];
    if (current?.status === "recording" || current?.status === "uploading") return;
    void refreshVisitConversation(activeAppointment.id);
    // Conversation refresh should run when the selected appointment changes, not on every poll state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppointment?.id]);

  async function loadDashboard() {
    try {
      const response = await fetch(`/api/doctor-dashboard?doctorId=${encodeURIComponent(doctorId)}`);
      if (response.status === 401 || response.status === 404) {
        router.replace("/doctor");
        return;
      }
      if (!response.ok) {
        throw new Error("Dashboard request failed");
      }
      const nextData = (await response.json()) as DashboardData;
      const nextAppointments = filterAppointments(nextData.appointments, dateFilter, query);
      const nextAppointment = nextAppointments.find((appointment) => appointment.id === activeAppointmentId) ?? nextAppointments[0];

      setData(nextData);
      setCopilotByAppointment((current) => hydrateCopilotStates(nextData.appointments, current));
      setClinicalNotesByAppointment(hydrateClinicalNotes(nextData.appointments));
      if (nextAppointment) {
        setActiveAppointmentId(nextAppointment.id);
        const nextForm = fromRecord(nextAppointment.clinicalRecord);
        setForm((current) => ({
          ...nextForm,
          diagnosis: clinicalNoteDirtyRef.current.diagnosis ? current.diagnosis : nextForm.diagnosis,
          observations: clinicalNoteDirtyRef.current.observations ? current.observations : nextForm.observations,
          followUpNotes: clinicalNoteDirtyRef.current.followUpNotes ? current.followUpNotes : nextForm.followUpNotes,
        }));
      }
    } catch {
      showAlert("Could not load doctor dashboard. Check database seed and refresh.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function requestCopilotAnalysis(
    mode: "loadAnalysis" | "consultAnalysis",
    appointment = activeAppointment,
    clinicalForm = form,
  ) {
    if (!appointment) return;

    setCopilotByAppointment((current) => ({
      ...current,
      [appointment.id]: {
        status: "loading",
        mode,
        result: current[appointment.id]?.result ?? null,
        error: "",
      },
    }));

    try {
      const response = await fetch("/api/doctor-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          appointment,
          clinicalForm,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setCopilotByAppointment((current) => ({
          ...current,
          [appointment.id]: {
            status: "error",
            mode,
            result: current[appointment.id]?.result ?? null,
            error: body.message ?? "Could not generate copilot analysis.",
          },
        }));
        return;
      }

      setCopilotByAppointment((current) => ({
        ...current,
        [appointment.id]: {
          status: "ready",
          mode,
          result: body as CopilotAnalysis,
          error: "",
        },
      }));
    } catch {
      setCopilotByAppointment((current) => ({
        ...current,
        [appointment.id]: {
          status: "error",
          mode,
          result: current[appointment.id]?.result ?? null,
          error: "Could not reach the clinical copilot service.",
        },
      }));
    }
  }

  function updateConversationState(appointmentId: string, update: Partial<ConversationPanelState>) {
    if (!visitConversationRecordingEnabled) return;

    setConversationByAppointment((current) => ({
      ...current,
      [appointmentId]: {
        ...(current[appointmentId] ?? blankConversationState),
        ...update,
      },
    }));
  }

  async function refreshVisitConversation(appointmentId: string, poll = false) {
    if (!visitConversationRecordingEnabled) return;

    try {
      const response = await fetch(
        `/api/visit-conversations?doctorId=${encodeURIComponent(doctorId)}&appointmentId=${encodeURIComponent(appointmentId)}`,
      );

      if (!response.ok) return;

      const body = (await response.json()) as VisitConversationApiResponse;
      const conversation = body.conversation;

      if (body.clinicalNotes) {
        applyClinicalNotesSnapshot(appointmentId, body.clinicalNotes);
      }

      if (!conversation) {
        if (!poll) {
          updateConversationState(appointmentId, blankConversationState);
        }
        return;
      }

      updateConversationState(appointmentId, mapConversationResponse(conversation));

      if (["UPLOADED", "TRANSCRIBING", "LABELING"].includes(conversation.status)) {
        scheduleConversationPoll(appointmentId);
      } else if (
        conversation.status === "COMPLETED" &&
        (body.clinicalNotes?.generationStatus === "PENDING" || body.clinicalNotes?.generationStatus === "PROCESSING")
      ) {
        void requestClinicalNoteGeneration(appointmentId);
      }
    } catch {
      if (poll) {
        scheduleConversationPoll(appointmentId);
      }
    }
  }

  function applyClinicalNotesSnapshot(appointmentId: string, snapshot: ClinicalNotesSnapshot) {
    setClinicalNotesByAppointment((current) => ({ ...current, [appointmentId]: snapshot }));

    if (appointmentId !== activeAppointmentId) return;

    setForm((current) => ({
      ...current,
      diagnosis: clinicalNoteDirtyRef.current.diagnosis ? current.diagnosis : snapshot.diagnosis,
      observations: clinicalNoteDirtyRef.current.observations ? current.observations : snapshot.observations,
      followUpNotes: clinicalNoteDirtyRef.current.followUpNotes ? current.followUpNotes : snapshot.followUpNotes,
    }));
  }

  async function requestClinicalNoteGeneration(appointmentId: string) {
    setClinicalNotesByAppointment((current) => {
      const existing = current[appointmentId] ?? blankClinicalNotesSnapshot;
      return {
        ...current,
        [appointmentId]: {
          ...existing,
          generationStatus: "PROCESSING",
          generationError: "",
        },
      };
    });

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generateClinicalNotes", doctorId, appointmentId }),
      });
      const body = await response.json();

      if (body.clinicalNotes) {
        applyClinicalNotesSnapshot(appointmentId, body.clinicalNotes as ClinicalNotesSnapshot);
      }

      if (!response.ok) {
        setClinicalNotesByAppointment((current) => ({
          ...current,
          [appointmentId]: {
            ...(current[appointmentId] ?? blankClinicalNotesSnapshot),
            generationStatus: "FAILED",
            generationError: body.message ?? "Could not generate clinical notes.",
          },
        }));
        showAlert(body.message ?? "Could not generate clinical notes.", "error");
      } else if (body.clinicalNotes?.generationStatus === "PROCESSING") {
        scheduleConversationPoll(appointmentId);
      } else {
        await loadDashboard();
      }
    } catch {
      setClinicalNotesByAppointment((current) => ({
        ...current,
        [appointmentId]: {
          ...(current[appointmentId] ?? blankClinicalNotesSnapshot),
          generationStatus: "FAILED",
          generationError: "Could not reach the clinical-note generation service.",
        },
      }));
    }
  }

  async function retryVisitConversation(appointmentId: string) {
    updateConversationState(appointmentId, {
      status: "uploaded",
      message: "Retrying transcription",
      error: "",
    });
    setClinicalNotesByAppointment((current) => ({
      ...current,
      [appointmentId]: {
        ...(current[appointmentId] ?? blankClinicalNotesSnapshot),
        generationStatus: "PENDING",
        generationError: "",
      },
    }));

    try {
      const response = await fetch("/api/visit-conversations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, appointmentId }),
      });
      const body = await response.json();

      if (!response.ok) {
        updateConversationState(appointmentId, {
          status: "failed",
          message: "Transcript retry failed",
          error: body.message ?? "Could not retry the transcript.",
        });
        showAlert(body.message ?? "Could not retry the transcript.", "error");
        return;
      }

      scheduleConversationPoll(appointmentId);
      showAlert(body.message ?? "Transcription retry started.", "success");
    } catch {
      updateConversationState(appointmentId, {
        status: "failed",
        message: "Transcript retry failed",
        error: "Could not reach the conversation service.",
      });
    }
  }

  function openHistoryConversation(entry: HistoryEntry, appointment: DoctorAppointment) {
    setHistoryConversationDialog({
      appointmentId: appointment.id,
      bookingCode: appointment.bookingCode,
      patientName: appointment.patient.name,
      historyTitle: entry.title,
    });
    void refreshVisitConversation(appointment.id);
  }

  function scheduleConversationPoll(appointmentId: string) {
    if (!visitConversationRecordingEnabled) return;

    const existing = conversationPollTimersRef.current[appointmentId];
    if (existing) {
      window.clearTimeout(existing);
    }

    conversationPollTimersRef.current[appointmentId] = window.setTimeout(() => {
      delete conversationPollTimersRef.current[appointmentId];
      void refreshVisitConversation(appointmentId, true);
    }, 3000);
  }

  async function startVisitConversationRecording(appointment: DoctorAppointment) {
    if (!visitConversationRecordingEnabled) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      updateConversationState(appointment.id, {
        status: "failed",
        message: "Recording unavailable",
        error: "Microphone recording is not supported in this browser.",
      });
      return;
    }

    const currentRecorder = conversationRecorderRef.current;
    if (currentRecorder && currentRecorder.state !== "inactive") {
      currentRecorder.stop();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const startedAt = new Date().toISOString();

      conversationChunksRef.current = [];
      conversationStreamRef.current = stream;
      conversationRecorderRef.current = recorder;
      activeConversationRef.current = {
        appointmentId: appointment.id,
        bookingCode: appointment.bookingCode,
        startedAt,
        mimeType: mimeType || recorder.mimeType || "audio/webm",
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          conversationChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const active = activeConversationRef.current;
        const chunks = conversationChunksRef.current;
        const resolver = conversationStopResolverRef.current;

        stopConversationTracks();
        conversationRecorderRef.current = null;
        activeConversationRef.current = null;
        conversationChunksRef.current = [];
        conversationStopResolverRef.current = null;

        if (!resolver || !active || !chunks.length) {
          resolver?.(null);
          return;
        }

        resolver({
          ...active,
          chunks,
          recording: new Blob(chunks, { type: active.mimeType }),
        });
      };

      recorder.start(conversationChunkMilliseconds);
      updateConversationState(appointment.id, {
        status: "recording",
        message: "Recording visit conversation",
        error: "",
        turns: [],
        warnings: [],
        language: "",
        plainTranscript: "",
        updatedAt: "",
      });
    } catch (error) {
      stopConversationTracks();
      updateConversationState(appointment.id, {
        status: "failed",
        message: "Recording failed",
        error: error instanceof Error ? error.message : "Microphone permission was denied.",
      });
    }
  }

  function stopVisitConversationRecording(appointmentId: string) {
    if (!visitConversationRecordingEnabled) {
      return Promise.resolve(null);
    }

    const recorder = conversationRecorderRef.current;
    const active = activeConversationRef.current;

    if (!recorder || recorder.state === "inactive" || active?.appointmentId !== appointmentId) {
      return Promise.resolve(null);
    }

    return new Promise<RecordedConversation | null>((resolve) => {
      conversationStopResolverRef.current = resolve;
      recorder.requestData();
      recorder.stop();
    });
  }

  async function uploadVisitConversation(
    recording: RecordedConversation,
    durationSeconds: number,
    completedAt: string,
  ): Promise<boolean> {
    if (!visitConversationRecordingEnabled) return false;

    updateConversationState(recording.appointmentId, {
      status: "uploading",
      message: "Uploading conversation recording",
      error: "",
    });

    const payload = new FormData();
    payload.set("doctorId", doctorId);
    payload.set("appointmentId", recording.appointmentId);
    payload.set("bookingCode", recording.bookingCode);
    payload.set("durationSeconds", String(durationSeconds));
    payload.set("startedAt", recording.startedAt);
    payload.set("completedAt", completedAt);
    payload.set("recording", recording.recording, `recording.${extensionForMimeType(recording.mimeType)}`);
    recording.chunks.forEach((chunk, index) => {
      payload.append("chunks", chunk, `chunk-${String(index + 1).padStart(3, "0")}.${extensionForMimeType(recording.mimeType)}`);
    });

    try {
      const response = await fetch("/api/visit-conversations", {
        method: "POST",
        body: payload,
      });
      const body = await response.json();

      if (!response.ok) {
        updateConversationState(recording.appointmentId, {
          status: "failed",
          message: "Conversation upload failed",
          error: body.message ?? "Could not upload visit conversation.",
        });
        return false;
      }

      updateConversationState(recording.appointmentId, {
        status: "uploaded",
        message: "Conversation uploaded. Transcription is starting.",
        error: "",
      });
      scheduleConversationPoll(recording.appointmentId);
      return true;
    } catch {
      updateConversationState(recording.appointmentId, {
        status: "failed",
        message: "Conversation upload failed",
        error: "Could not reach the visit conversation service.",
      });
      return false;
    }
  }

  function stopConversationTracks() {
    conversationStreamRef.current?.getTracks().forEach((track) => track.stop());
    conversationStreamRef.current = null;
  }

  async function startAppointment() {
    if (!activeAppointment || saving) return;
    setSaving(true);
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", doctorId, appointmentId: activeAppointment.id }),
      });

      if (!response.ok) {
        showAlert("Could not start appointment.", "error");
        return;
      }

      await loadDashboard();
      if (visitConversationRecordingEnabled) {
        await startVisitConversationRecording(activeAppointment);
      }
      showAlert("Appointment started.", "success");
    } catch {
      showAlert("Could not start appointment.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function createFollowUp() {
    if (!activeAppointment || activeAppointment.status !== "COMPLETED" || saving) return;

    prepareClinicalNotesForAppointmentChange();
    setSaving(true);
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createFollowUp",
          doctorId,
          appointmentId: activeAppointment.id,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not create the follow-up visit.", "error");
        return;
      }

      await loadDashboard();
      setQuery("");
      setDateFilter(getDateKey(body.startsAt));
      setActiveAppointmentId(body.appointmentId);
      setForm(blankForm);
      setTestResultForm({ testName: "" });
      showAlert(body.message ?? "Follow-up added to today's waiting queue.", "success");
    } catch {
      showAlert("Could not reach the doctor queue.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function checkInQrCode(rawCode: string) {
    const bookingCode = rawCode.trim().toUpperCase();

    setQrScanner((current) => ({ ...current, status: "scanning", message: "Verifying booking QR..." }));
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scanQr", doctorId, bookingCode }),
      });
      const body = await response.json();

      if (!response.ok) {
        setQrScanner((current) => ({
          ...current,
          status: "error",
          message: body.message ?? "Could not verify this QR.",
          result: null,
        }));
        return false;
      }

      await loadDashboard();
      setActiveAppointmentId(body.appointment.id);
      setQrScanner((current) => ({
        ...current,
        status: "success",
        message: body.message ?? "Patient checked in.",
        result: body.appointment as QrScanResult,
      }));
      showAlert("Patient moved to waiting.", "success");
      return true;
    } catch {
      setQrScanner((current) => ({
        ...current,
        status: "error",
        message: "Could not reach the doctor queue.",
        result: null,
      }));
      return false;
    }
  }

  async function saveRecord(action: "save" | "complete", clinicalForm = form, successMessage?: string) {
    if (!activeAppointment || saving) return false;
    setSaving(true);
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          doctorId,
          appointmentId: activeAppointment.id,
          ...clinicalForm,
          durationSeconds: getElapsedSeconds(activeAppointment, now),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not save clinical record.", "error");
        return false;
      }

      await loadDashboard();
      showAlert(successMessage ?? body.message ?? "Clinical record saved.", "success");
      return true;
    } catch {
      showAlert("Could not save clinical record.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function changeClinicalNote(field: ClinicalNoteField, value: string) {
    if (!activeAppointment) return;

    const snapshot = clinicalNotesByAppointment[activeAppointment.id] ?? snapshotFromRecord(activeAppointment.clinicalRecord);
    if (!clinicalNoteDirtyRef.current[field] && snapshot.unverified[field]) {
      clinicalNoteDraftVersionRef.current[field] = snapshot.draftVersion;
    }

    clinicalNoteDirtyRef.current[field] = true;
    pendingClinicalNoteValueRef.current[field] = value;
    clinicalNoteEditSequenceRef.current[field] += 1;
    const sequence = clinicalNoteEditSequenceRef.current[field];

    setForm((current) => ({ ...current, [field]: value }));
    setClinicalNotesByAppointment((current) => ({
      ...current,
      [activeAppointment.id]: {
        ...(current[activeAppointment.id] ?? snapshot),
        [field]: value,
        unverified: {
          ...(current[activeAppointment.id]?.unverified ?? snapshot.unverified),
          [field]: false,
        },
      },
    }));
    setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "saving" }));

    const existingTimer = clinicalNoteSaveTimersRef.current[field];
    if (existingTimer) window.clearTimeout(existingTimer);
    clinicalNoteSaveTimersRef.current[field] = window.setTimeout(() => {
      delete clinicalNoteSaveTimersRef.current[field];
      void saveClinicalNote(field, value, sequence);
    }, 600);
  }

  function flushClinicalNote(field: ClinicalNoteField) {
    const timer = clinicalNoteSaveTimersRef.current[field];
    const value = pendingClinicalNoteValueRef.current[field];
    if (!timer || value === undefined) return;

    window.clearTimeout(timer);
    delete clinicalNoteSaveTimersRef.current[field];
    void saveClinicalNote(field, value, clinicalNoteEditSequenceRef.current[field]);
  }

  async function saveClinicalNote(field: ClinicalNoteField, value: string, sequence: number) {
    if (!activeAppointment) return;
    const appointmentId = activeAppointment.id;

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveClinicalNote",
          doctorId,
          appointmentId,
          noteField: field,
          noteValue: value,
          draftVersion: clinicalNoteDraftVersionRef.current[field] ?? "",
        }),
      });
      const body = await response.json();

      if (sequence !== clinicalNoteEditSequenceRef.current[field]) return;

      if (!response.ok) {
        setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "error" }));
        return;
      }

      clinicalNoteDirtyRef.current[field] = false;
      delete pendingClinicalNoteValueRef.current[field];
      delete clinicalNoteDraftVersionRef.current[field];
      setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "saved" }));
      if (body.clinicalNotes) {
        applyClinicalNotesSnapshot(appointmentId, body.clinicalNotes as ClinicalNotesSnapshot);
      }
    } catch {
      if (sequence === clinicalNoteEditSequenceRef.current[field]) {
        setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "error" }));
      }
    }
  }

  async function verifyClinicalNote(field: ClinicalNoteField) {
    if (!activeAppointment) return;
    const appointmentId = activeAppointment.id;
    setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "saving" }));

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verifyClinicalNote",
          doctorId,
          appointmentId,
          noteField: field,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "error" }));
        return;
      }

      setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "saved" }));
      if (body.clinicalNotes) {
        applyClinicalNotesSnapshot(appointmentId, body.clinicalNotes as ClinicalNotesSnapshot);
      }
    } catch {
      setClinicalNoteSaveStatus((current) => ({ ...current, [field]: "error" }));
    }
  }

  async function completeAppointment() {
    if (!activeAppointment || saving) return;

    const appointment = activeAppointment;
    const durationSeconds = getElapsedSeconds(appointment, now);
    const completedAt = new Date().toISOString();
    let conversationUploaded = false;
    setSaving(true);

    try {
      if (visitConversationRecordingEnabled) {
        const recording = await stopVisitConversationRecording(appointment.id);
        if (!recording) {
          const state = conversationByAppointment[appointment.id];
          if (state?.status === "recording") {
            updateConversationState(appointment.id, {
              status: "failed",
              message: "Recording unavailable",
              error: "No conversation audio was captured.",
            });
          }
        } else {
          conversationUploaded = await uploadVisitConversation(recording, durationSeconds, completedAt);
        }
      }

      await saveRecord(
        "complete",
        form,
        conversationUploaded
          ? "Appointment completed. Transcribing and generating clinical notes."
          : "Appointment completed.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveVitals(nextVitals: typeof blankForm.vitals) {
    if (!activeAppointment || savingVitals) return;
    setSavingVitals(true);
    setForm((current) => ({ ...current, vitals: nextVitals }));

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveVitals",
          doctorId,
          appointmentId: activeAppointment.id,
          vitals: nextVitals,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not save vitals.", "error");
        return;
      }

      setData((current) => ({
        ...current,
        appointments: current.appointments.map((appointment) =>
          appointment.id === activeAppointment.id
            ? {
                ...appointment,
                clinicalRecord: {
                  id: body.clinicalRecordId ?? appointment.clinicalRecord?.id ?? "",
                  diagnosis: appointment.clinicalRecord?.diagnosis ?? "",
                  observations: appointment.clinicalRecord?.observations ?? "",
                  followUpNotes: appointment.clinicalRecord?.followUpNotes ?? "",
                  diagnosisAiDraft: appointment.clinicalRecord?.diagnosisAiDraft ?? "",
                  observationsAiDraft: appointment.clinicalRecord?.observationsAiDraft ?? "",
                  followUpNotesAiDraft: appointment.clinicalRecord?.followUpNotesAiDraft ?? "",
                  clinicalNotesGenerationStatus: appointment.clinicalRecord?.clinicalNotesGenerationStatus ?? "IDLE",
                  clinicalNotesGenerationError: appointment.clinicalRecord?.clinicalNotesGenerationError ?? "",
                  clinicalNotesModelName: appointment.clinicalRecord?.clinicalNotesModelName ?? "",
                  clinicalNotesGeneratedAt: appointment.clinicalRecord?.clinicalNotesGeneratedAt ?? null,
                  clinicalNotesDraftVersion: appointment.clinicalRecord?.clinicalNotesDraftVersion ?? "",
                  startedAt: appointment.clinicalRecord?.startedAt ?? null,
                  completedAt: appointment.clinicalRecord?.completedAt ?? null,
                  durationSeconds: appointment.clinicalRecord?.durationSeconds ?? 0,
                  prescriptions: appointment.clinicalRecord?.prescriptions ?? [],
                  testResults: appointment.clinicalRecord?.testResults ?? [],
                  vitals: nextVitals,
                },
              }
            : appointment,
        ),
      }));
      showAlert(body.message ?? "Vitals saved.", "success");
    } catch {
      showAlert("Could not save vitals.", "error");
    } finally {
      setSavingVitals(false);
    }
  }

  async function saveTestResult(files: FileList | null) {
    if (!activeAppointment || savingTestResult) return false;
    const selectedFiles = Array.from(files ?? []);

    if (!testResultForm.testName.trim() || !selectedFiles.length) {
      showAlert("Add a test name and at least one result image.", "error");
      return false;
    }

    setSavingTestResult(true);
    setDashboardAlert(null);

    try {
      const payload = new FormData();
      payload.set("doctorId", doctorId);
      payload.set("appointmentId", activeAppointment.id);
      payload.set("testName", testResultForm.testName.trim());
      selectedFiles.forEach((file) => payload.append("images", file));

      const response = await fetch("/api/doctor-tests", {
        method: "POST",
        body: payload,
      });
      const body = await response.json();

      if (!response.ok) {
        await loadDashboard();
        showAlert(body.message ?? "Could not extract test result.", "error");
        return false;
      }

      setTestResultForm({ testName: "" });
      await loadDashboard();
      showAlert(body.message ?? "Test result extracted and saved.", "success");
      return true;
    } catch {
      showAlert("Could not upload test result.", "error");
      return false;
    } finally {
      setSavingTestResult(false);
    }
  }

  async function addPatientToSlot() {
    if (!addPatientSlot || savingAddedPatient) return;

    if (
      !addPatientForm.name.trim() ||
      !addPatientForm.age ||
      !addPatientForm.gender ||
      addPatientForm.phone.length !== 10 ||
      !addPatientForm.visitReason.trim()
    ) {
      showAlert("Patient name, age, gender, contact, and reason are required.", "error");
      return;
    }

    setSavingAddedPatient(true);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addAppointment",
          doctorId,
          slotStartsAt: addPatientSlot.startsAt,
          patient: addPatientForm,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not add patient to slot.", "error");
        return;
      }

      setAddPatientSlot(null);
      setAddPatientForm(blankAddPatientForm);
      setActiveAppointmentId(body.appointmentId ?? "");
      setForm(blankForm);
      setTestResultForm({ testName: "" });
      await loadDashboard();
      showAlert("Patient added to slot.", "success");
    } catch {
      showAlert("Could not add patient to slot.", "error");
    } finally {
      setSavingAddedPatient(false);
    }
  }

  async function deleteTestResult(testResultId: string) {
    if (!activeAppointment || deletingTestId) return;

    setDeletingTestId(testResultId);
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-tests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId,
          testResultId,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not delete test result.", "error");
        return;
      }

      setPendingTestDelete(null);
      await loadDashboard();
      showAlert(body.message ?? "Test result deleted.", "success");
    } catch {
      showAlert("Could not delete test result.", "error");
    } finally {
      setDeletingTestId("");
    }
  }

  function showAlert(message: string, tone: DashboardAlert["tone"]) {
    setDashboardAlert({ id: Date.now(), message, tone });
  }

  async function addHistory() {
    if (!activeAppointment || saving) return false;
    setSaving(true);
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addHistory",
          doctorId,
          appointmentId: activeAppointment.id,
          patientId: activeAppointment.patient.id,
          history: historyForm,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not add patient history.", "error");
        return false;
      }

      setHistoryForm({ title: "", detail: "" });
      await loadDashboard();
      showAlert(body.message ?? "Patient history added.", "success");
      return true;
    } catch {
      showAlert("Could not add patient history.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function deleteHistory(historyId: string) {
    if (!activeAppointment || saving) return;
    setSaving(true);
    setDashboardAlert(null);

    try {
      const response = await fetch("/api/doctor-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteHistory",
          doctorId,
          appointmentId: activeAppointment.id,
          historyId,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        showAlert(body.message ?? "Could not delete patient history.", "error");
        return;
      }

      await loadDashboard();
      showAlert(body.message ?? "Patient history deleted.", "success");
    } catch {
      showAlert("Could not delete patient history.", "error");
    } finally {
      setSaving(false);
    }
  }

  function updatePrescription(index: number, key: keyof Prescription, value: string) {
    setForm((current) => ({
      ...current,
      prescriptions: current.prescriptions.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  }

  function selectAppointment(appointmentId: string) {
    const nextAppointment = data.appointments.find((appointment) => appointment.id === appointmentId);
    prepareClinicalNotesForAppointmentChange();
    setActiveAppointmentId(appointmentId);
    setForm(fromRecord(nextAppointment?.clinicalRecord ?? null));
    setTestResultForm({ testName: "" });
    setDashboardAlert(null);
  }

  function selectDate(dateKey: string) {
    const nextAppointments = filterAppointments(data.appointments, dateKey, query);
    const nextAppointment =
      nextAppointments.find((appointment) => appointment.id === activeAppointmentId) ?? nextAppointments[0];

    prepareClinicalNotesForAppointmentChange();
    setDateFilter(dateKey);
    setActiveAppointmentId(nextAppointment?.id ?? "");
    setForm(fromRecord(nextAppointment?.clinicalRecord ?? null));
    setTestResultForm({ testName: "" });
    setDashboardAlert(null);
  }

  function updateQuery(value: string) {
    const nextAppointments = filterAppointments(data.appointments, dateFilter, value);
    const nextAppointment =
      nextAppointments.find((appointment) => appointment.id === activeAppointmentId) ?? nextAppointments[0];

    setQuery(value);
    if (!nextAppointment || nextAppointment.id !== activeAppointmentId) {
      prepareClinicalNotesForAppointmentChange();
      setActiveAppointmentId(nextAppointment?.id ?? "");
      setForm(fromRecord(nextAppointment?.clinicalRecord ?? null));
      setTestResultForm({ testName: "" });
    }
  }

  function selectVisit(appointmentId: string) {
    const nextAppointment = data.appointments.find((appointment) => appointment.id === appointmentId);
    if (!nextAppointment) return;

    prepareClinicalNotesForAppointmentChange();
    setDateFilter(getDateKey(nextAppointment.slot.startsAt));
    setActiveAppointmentId(nextAppointment.id);
    setForm(fromRecord(nextAppointment.clinicalRecord));
    setTestResultForm({ testName: "" });
    setDashboardAlert(null);
  }

  function prepareClinicalNotesForAppointmentChange() {
    (["diagnosis", "observations", "followUpNotes"] as ClinicalNoteField[]).forEach(flushClinicalNote);
    clinicalNoteDirtyRef.current = {
      diagnosis: false,
      observations: false,
      followUpNotes: false,
    };
    clinicalNoteDraftVersionRef.current = {};
    pendingClinicalNoteValueRef.current = {};
    setClinicalNoteSaveStatus({
      diagnosis: "idle",
      observations: "idle",
      followUpNotes: "idle",
    });
  }

  function removePrescription(index: number) {
    setForm((current) => ({
      ...current,
      prescriptions:
        current.prescriptions.length === 1
          ? [{ ...blankPrescription }]
          : current.prescriptions.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="flex items-center gap-3 rounded-[18px] border bg-white px-5 py-4 text-sm font-semibold shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading doctor workspace
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 h-dvh w-full overflow-hidden overscroll-none bg-[#f7fafc] px-3 py-3 text-[13px] sm:px-4 lg:px-5">
      {dashboardAlert ? <DashboardToast alert={dashboardAlert} /> : null}
      {pendingTestDelete ? (
        <DeleteTestConfirmDialog
          deleting={deletingTestId === pendingTestDelete.id}
          test={pendingTestDelete}
          onCancel={() => {
            if (!deletingTestId) setPendingTestDelete(null);
          }}
          onConfirm={() => deleteTestResult(pendingTestDelete.id)}
        />
      ) : null}
      {addPatientSlot ? (
        <AddPatientDialog
          doctor={data.doctor}
          form={addPatientForm}
          saving={savingAddedPatient}
          slotStartsAt={addPatientSlot.startsAt}
          onCancel={() => {
            if (!savingAddedPatient) {
              setAddPatientSlot(null);
              setAddPatientForm(blankAddPatientForm);
            }
          }}
          onChange={(key, value) => setAddPatientForm((current) => ({ ...current, [key]: value }))}
          onConfirm={addPatientToSlot}
        />
      ) : null}
      {qrScanner.open ? (
        <QrScannerDialog
          state={qrScanner}
          onCancel={() => setQrScanner(blankQrScannerState)}
          onScan={checkInQrCode}
          onRetry={() => setQrScanner({ open: true, status: "idle", message: "", result: null })}
        />
      ) : null}
      {historyConversationDialog ? (
        <HistoryConversationDialog
          conversation={conversationByAppointment[historyConversationDialog.appointmentId] ?? blankConversationState}
          dialog={historyConversationDialog}
          onClose={() => setHistoryConversationDialog(null)}
        />
      ) : null}
      <section className="grid h-full w-full gap-3 overflow-hidden xl:grid-cols-[280px_minmax(0,0.85fr)_minmax(370px,0.45fr)]">
        <DoctorQueue
          doctor={data.doctor}
          activeAppointmentId={activeAppointment?.id ?? ""}
          appointments={visibleAppointments}
          dateFilter={dateFilter}
          query={query}
          onSelectAppointment={selectAppointment}
          onUpdateQuery={updateQuery}
          onOpenAddPatient={(startsAt) => {
            setAddPatientSlot({ startsAt });
            setAddPatientForm(blankAddPatientForm);
          }}
        />

        <section className="scrollbar-none min-h-0 min-w-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
          <EncounterHeader
            appointment={activeAppointment}
            availableDates={dateOptions.map((date) => date.value)}
            patientVisits={patientVisits}
            selectedDate={dateFilter}
            elapsedSeconds={activeAppointment ? getElapsedSeconds(activeAppointment, now) : 0}
            saving={saving}
            onSelectDate={selectDate}
            onSelectVisit={selectVisit}
            onOpenScanner={() => setQrScanner({ open: true, status: "idle", message: "", result: null })}
            onStart={startAppointment}
            onComplete={completeAppointment}
            onFollowUp={createFollowUp}
          />

          {activeAppointment ? (
            <div className="space-y-3">
              <PatientVitalsCard
                appointment={activeAppointment}
                vitals={form.vitals}
                onChange={(key, value) =>
                  setForm((current) => ({ ...current, vitals: { ...current.vitals, [key]: value } }))
                }
                onSave={saveVitals}
              />
              <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                <ClinicalNotesPanel
                  appointmentId={activeAppointment.id}
                  form={form}
                  notes={activeClinicalNotes}
                  saveStatus={clinicalNoteSaveStatus}
                  onBlur={flushClinicalNote}
                  onChange={changeClinicalNote}
                  onRetry={() =>
                    activeConversation.status === "failed"
                      ? retryVisitConversation(activeAppointment.id)
                      : requestClinicalNoteGeneration(activeAppointment.id)
                  }
                  onVerify={verifyClinicalNote}
                />
                <PatientHistoryCard
                  appointment={activeAppointment}
                  historyForm={historyForm}
                  saving={saving}
                  onAddHistory={addHistory}
                  onDeleteHistory={deleteHistory}
                  onOpenConversation={openHistoryConversation}
                  onHistoryChange={(key, value) => setHistoryForm((current) => ({ ...current, [key]: value }))}
                />
              </div>
              <TestResultsPanel
                appointment={activeAppointment}
                deletingTestId={deletingTestId}
                testResultForm={testResultForm}
                saving={savingTestResult}
                onChange={(key, value) => setTestResultForm((current) => ({ ...current, [key]: value }))}
                onDelete={(testResult) =>
                  setPendingTestDelete({
                    id: testResult.id,
                    name: testResult.reportTitle || testResult.testName,
                    imageCount: testResult.images.length,
                  })
                }
                onSave={saveTestResult}
              />
              <PrescriptionPanel
                appointment={activeAppointment}
                form={form}
                prescriptions={form.prescriptions}
                onAdd={() =>
                  setForm((current) => ({
                    ...current,
                    prescriptions: [...current.prescriptions, { ...blankPrescription }],
                  }))
                }
                onChange={updatePrescription}
                onRemove={removePrescription}
              />
            </div>
          ) : (
            <EmptyPanel />
          )}
        </section>

        <ClinicalAICopilotPanel
          appointment={activeAppointment}
          copilot={activeCopilot}
          conversation={visitConversationRecordingEnabled ? activeConversation : undefined}
          onRefresh={() =>
            activeAppointment
              ? requestCopilotAnalysis("loadAnalysis", activeAppointment, fromRecord(activeAppointment.clinicalRecord))
              : undefined
          }
        />
      </section>
    </main>
  );
}

function DoctorQueue({
  doctor,
  activeAppointmentId,
  appointments,
  dateFilter,
  query,
  onSelectAppointment,
  onUpdateQuery,
  onOpenAddPatient,
}: {
  doctor: Doctor | null;
  activeAppointmentId: string;
  appointments: DoctorAppointment[];
  dateFilter: string;
  query: string;
  onSelectAppointment: (id: string) => void;
  onUpdateQuery: (value: string) => void;
  onOpenAddPatient: (startsAt: string) => void;
}) {
  const counts = getCounts(appointments);
  const slotGroups = groupAppointmentsByMainSlot(appointments, dateFilter);

  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden px-1">
      <div className="shrink-0 rounded-[14px] border bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-foreground">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Doctor Console</p>
            {doctor ? <p className="truncate text-xs font-semibold text-slate-500">{doctor.name}</p> : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <Metric label="Waiting" value={counts.waiting} tone="blue" />
          <Metric label="Active" value={counts.active} tone="green" />
          <Metric label="Done" value={counts.done} tone="slate" />
        </div>
      </div>

      <div className="shrink-0 rounded-[14px] border bg-white p-2 shadow-sm">
        <div className="min-w-0">
          <label className="flex h-9 items-center gap-2 rounded-[11px] border bg-[#f8fafc] px-2.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-slate-300"
              value={query}
              onChange={(event) => onUpdateQuery(event.target.value)}
              placeholder="Search patient, code, or reason"
            />
          </label>
        </div>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-0.5 py-1">
        {slotGroups.map((group) => (
            <section key={group.id} className="rounded-[14px] border bg-white p-2.5 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
                    {group.label}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {group.appointments.length} patient{group.appointments.length === 1 ? "" : "s"}
                  </p>
                </div>
                {group.canAddPatient ? (
                  <button
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border bg-secondary text-primary transition hover:border-primary/45 hover:bg-accent"
                    type="button"
                    onClick={() => onOpenAddPatient(group.startsAt)}
                    aria-label={`Add patient in ${group.label}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-violet-700">
                    Same day
                  </span>
                )}
              </div>
              {group.appointments.length ? (
                <div className="space-y-2">
                  {group.appointments.map((appointment) => (
                  <button
                    key={appointment.id}
                    className={cn(
                      "w-full rounded-[12px] border bg-[#fbfdff] p-2.5 text-left transition hover:border-primary/45",
                      activeAppointmentId === appointment.id &&
                        "border-blue-500 bg-blue-50/70 shadow-none ring-2 ring-blue-500/25",
                    )}
                    onClick={() => onSelectAppointment(appointment.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-800">{appointment.patient.name}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {formatTime(appointment.slot.startsAt)} · {appointment.patient.age} yrs / {formatGender(appointment.patient.gender)}
                        </p>
                      </div>
                      <StatusPill status={appointment.status} />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-4 text-slate-600">{appointment.visitReason}</p>
                  </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-[12px] border border-dashed bg-[#fbfdff] p-3 text-xs font-semibold text-slate-400">
                  No patients in this slot.
                </div>
              )}
            </section>
        ))}
      </div>
    </aside>
  );
}

function DateCalendar({
  availableDates,
  selectedDate,
  onSelectDate,
}: {
  availableDates: string[];
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateKey(selectedDate));
  const availableDateSet = useMemo(() => new Set(availableDates), [availableDates]);
  const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);
  const monthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  function moveMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function selectToday() {
    const todayKey = getTodayDateKey();
    setVisibleMonth(parseDateKey(todayKey));
    onSelectDate(todayKey);
    setOpen(false);
  }

  function selectDate(dateKey: string) {
    onSelectDate(dateKey);
    setOpen(false);
  }

  return (
    <div className="relative min-w-0">
      <button
        className={cn(
          "flex h-9 w-[190px] min-w-[170px] items-center justify-start gap-2 rounded-[11px] border bg-white px-3 text-left text-xs font-bold text-slate-800 shadow-sm transition hover:border-primary/50 hover:bg-secondary",
          open && "border-primary ring-2 ring-primary/15",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
        aria-expanded={open}
        aria-label={`Filter by date, selected ${formatCalendarDate(selectedDate)}`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 truncate">{formatCalendarDate(selectedDate)}</span>
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-2 w-[300px] rounded-[18px] border bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <CalendarDays className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{monthLabel}</p>
                <p className="text-xs font-medium text-muted-foreground">{formatCalendarDate(selectedDate)}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full border bg-white text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                onClick={() => moveMonth(-1)}
                type="button"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full border bg-white text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                onClick={() => moveMonth(1)}
                type="button"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const active = day.dateKey === selectedDate;
              const today = day.dateKey === getTodayDateKey();
              const hasAppointments = availableDateSet.has(day.dateKey);

              return (
                <button
                  key={day.dateKey}
                  className={cn(
                    "relative flex aspect-square min-h-9 items-center justify-center rounded-full text-sm font-semibold transition",
                    day.inMonth ? "text-foreground" : "text-muted-foreground/45",
                    active ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-secondary hover:text-primary",
                    today && !active && "ring-1 ring-primary/35",
                  )}
                  onClick={() => selectDate(day.dateKey)}
                  type="button"
                  aria-pressed={active}
                >
                  {day.label}
                  {hasAppointments ? (
                    <span
                      className={cn(
                        "absolute bottom-1 h-1 w-1 rounded-full",
                        active ? "bg-primary-foreground" : "bg-primary",
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <button
            className="mt-3 h-9 w-full rounded-[18px] bg-secondary text-sm font-bold text-primary transition hover:bg-accent"
            onClick={selectToday}
            type="button"
          >
            Today
          </button>
        </div>
      ) : null}
    </div>
  );
}

function VisitSelector({
  appointment,
  visits,
  onSelectVisit,
}: {
  appointment?: DoctorAppointment;
  visits: DoctorAppointment[];
  onSelectVisit: (appointmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function chooseVisit(appointmentId: string) {
    onSelectVisit(appointmentId);
    setOpen(false);
  }

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <button
        className={cn(
          "flex h-9 w-[190px] min-w-[170px] items-center justify-between gap-2 rounded-[11px] border bg-white px-3 text-left shadow-sm transition hover:border-primary/50 hover:bg-secondary",
          open && "border-primary ring-2 ring-primary/15",
        )}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={!appointment}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
      >
        <span className="min-w-0">
          <span className="block text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-slate-400">
            Visit
          </span>
          <span className="mt-0.5 block truncate text-xs font-bold text-slate-800">
            {appointment
              ? `${appointment.visitType === "FOLLOW_UP" ? "Follow-up" : "Initial"} · ${formatShortDate(appointment.slot.startsAt)}`
              : "No patient selected"}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-primary transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id={listId}
          className="absolute left-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-[16px] border bg-white shadow-xl"
          role="listbox"
          aria-label={`${appointment?.patient.name ?? "Patient"} visits`}
        >
          <div className="border-b bg-slate-50/80 px-3 py-2.5">
            <p className="truncate text-xs font-bold text-slate-900">{appointment?.patient.name}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
              {visits.length} visit{visits.length === 1 ? "" : "s"} with this doctor
            </p>
          </div>

          <div className="scrollbar-none max-h-[360px] space-y-1.5 overflow-y-auto p-2">
            {visits.length ? (
              visits.map((visit) => {
                const selected = visit.id === appointment?.id;
                const summary =
                  visit.clinicalRecord?.diagnosis ||
                  visit.clinicalRecord?.observations ||
                  visit.clinicalRecord?.followUpNotes ||
                  "No clinical summary recorded";

                return (
                  <button
                    key={visit.id}
                    className={cn(
                      "w-full rounded-[12px] border p-2.5 text-left transition hover:border-primary/40 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-primary/20",
                      selected ? "border-primary bg-blue-50/70" : "border-slate-200 bg-white",
                    )}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => chooseVisit(visit.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]",
                              visit.visitType === "FOLLOW_UP"
                                ? "bg-violet-100 text-violet-700"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {visit.visitType === "FOLLOW_UP" ? "Follow-up" : "Initial"}
                          </span>
                          <span className="text-[11px] font-bold text-slate-800">
                            {formatShortDate(visit.slot.startsAt)} · {formatTime(visit.slot.startsAt)}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[10px] font-semibold text-slate-400">
                          {visit.bookingCode}
                        </p>
                      </div>
                      <StatusPill status={visit.status} />
                    </div>
                    <p className="mt-2 line-clamp-1 text-xs font-semibold text-slate-700">{visit.visitReason}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{summary}</p>
                  </button>
                );
              })
            ) : (
              <div className="rounded-[12px] border border-dashed p-4 text-center text-xs font-semibold text-slate-400">
                No visits are available for this patient.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EncounterHeader({
  appointment,
  availableDates,
  patientVisits,
  selectedDate,
  elapsedSeconds,
  saving,
  onSelectDate,
  onSelectVisit,
  onOpenScanner,
  onStart,
  onComplete,
  onFollowUp,
}: {
  appointment?: DoctorAppointment;
  availableDates: string[];
  patientVisits: DoctorAppointment[];
  selectedDate: string;
  elapsedSeconds: number;
  saving: boolean;
  onSelectDate: (dateKey: string) => void;
  onSelectVisit: (appointmentId: string) => void;
  onOpenScanner: () => void;
  onStart: () => void;
  onComplete: () => void;
  onFollowUp: () => void;
}) {
  const actionLabel =
    appointment?.status === "IN_PROGRESS" ? "Complete" : appointment?.status === "COMPLETED" ? "Follow up" : "Start";
  const runAction =
    appointment?.status === "IN_PROGRESS"
      ? onComplete
      : appointment?.status === "COMPLETED"
        ? onFollowUp
        : onStart;

  return (
    <header className="rounded-[14px] border bg-white p-2.5 shadow-sm sm:p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
          <DateCalendar
            key={selectedDate}
            availableDates={availableDates}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
          />
          <VisitSelector
            appointment={appointment}
            visits={patientVisits}
            onSelectVisit={onSelectVisit}
          />
        </div>
        <div className="ml-auto flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
          <Button
            className="h-9 min-w-[88px] shrink-0 whitespace-nowrap rounded-[11px] border border-blue-100 bg-blue-50 px-3 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100"
            onClick={onOpenScanner}
            type="button"
          >
            <QrCode className="mr-1.5 h-4 w-4" />
            Scan QR
          </Button>
          <div className="flex h-9 min-w-[104px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[11px] border border-slate-200 bg-slate-50 px-3 font-mono text-base font-bold text-slate-900">
            <Timer className="h-4 w-4 text-primary" />
            {formatDuration(elapsedSeconds)}
          </div>
          <Button
            className={cn(
              "h-9 min-w-[104px] shrink-0 whitespace-nowrap rounded-[11px] px-4 text-xs font-bold shadow-sm",
              appointment?.status === "IN_PROGRESS"
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : appointment?.status === "COMPLETED"
                  ? "bg-violet-600 text-white hover:bg-violet-700"
                : "bg-slate-900 text-white hover:bg-slate-800",
            )}
            disabled={!appointment || saving}
            onClick={runAction}
            type="button"
          >
            {saving ? "Saving..." : actionLabel}
          </Button>
        </div>
      </div>
    </header>
  );
}

function QrScannerDialog({
  state,
  onCancel,
  onScan,
  onRetry,
}: {
  state: QrScannerState;
  onCancel: () => void;
  onScan: (code: string) => Promise<boolean>;
  onRetry: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (state.status !== "idle") return;

    let stream: MediaStream | null = null;
    let frameId = 0;
    let stopped = false;

    async function startScanner() {
      setCameraError("");
      scannedRef.current = false;

      try {
        const BarcodeDetector = window.BarcodeDetector;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const detector = BarcodeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
        const scanFrame = async () => {
          if (stopped || scannedRef.current || !videoRef.current) return;

          try {
            const rawValue = detector
              ? (await detector.detect(videoRef.current))[0]?.rawValue?.trim()
              : decodeQrFromVideo(videoRef.current, canvasRef.current);

            if (rawValue) {
              scannedRef.current = true;
              await onScanRef.current(rawValue);
              return;
            }
          } catch {
            setCameraError("Could not read the camera frame. Keep the QR steady inside the box.");
          }

          frameId = window.setTimeout(scanFrame, detector ? 450 : 180);
        };

        frameId = window.setTimeout(scanFrame, 500);
      } catch {
        setCameraError("Camera permission is needed to scan the patient QR.");
      }
    }

    startScanner();

    return () => {
      stopped = true;
      if (frameId) window.clearTimeout(frameId);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [state.status]);

  const result = state.result;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] rounded-[16px] border bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Patient check-in</p>
            <h2 className="mt-1 text-base font-bold text-slate-900">Scan booking QR</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Only hospital booking QR codes are accepted.</p>
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border bg-white text-slate-500 transition hover:border-primary/45 hover:text-primary"
            type="button"
            onClick={onCancel}
            aria-label="Close QR scanner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="mt-4 rounded-[14px] border border-blue-100 bg-blue-50/70 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white text-blue-700 shadow-sm">
                <BadgeCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{result.patient.name}</p>
                <p className="text-xs font-semibold text-blue-700">In Lobby</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 rounded-[12px] bg-white p-3 text-xs font-semibold text-slate-600 sm:grid-cols-2">
              <p>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Booking</span>
                {result.bookingCode}
              </p>
              <p>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Visit time</span>
                {formatFullDate(result.slot.startsAt)}
              </p>
              <p>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Patient</span>
                {result.patient.age} yrs / {formatGender(result.patient.gender)}
              </p>
              <p>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Status</span>
                {result.status.replace("_", " ")}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[14px] border bg-slate-950">
            <div className="relative aspect-[4/3] bg-slate-900">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
              <canvas ref={canvasRef} className="hidden" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-44 w-44 rounded-[18px] border-2 border-white/85 shadow-[0_0_0_999px_rgba(2,6,23,0.36)]" />
              </div>
              <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-slate-800">
                <ScanLine className="h-3.5 w-3.5 text-primary" />
                Scanning
              </div>
            </div>
          </div>
        )}

        {cameraError || state.message ? (
          <p
            className={cn(
              "mt-3 rounded-[11px] border px-3 py-2 text-xs font-semibold",
              state.status === "error" || cameraError
                ? "border-red-100 bg-red-50 text-red-700"
                : "border-blue-100 bg-blue-50 text-blue-700",
            )}
          >
            {cameraError || state.message}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {state.status === "error" || cameraError ? (
            <Button className="h-9 rounded-[11px] px-4 text-xs font-bold" type="button" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          <Button className="h-9 rounded-[11px] px-4 text-xs font-bold" type="button" onClick={onCancel}>
            {result ? "Done" : "Cancel"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function decodeQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement | null) {
  if (!canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return "";

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return "";

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";

  context.drawImage(video, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  return jsQR(imageData.data, width, height)?.data.trim() ?? "";
}

function DashboardToast({ alert }: { alert: DashboardAlert }) {
  const isSuccess = alert.tone === "success";

  return (
    <div
      key={alert.id}
      className={cn(
        "fixed left-1/2 top-4 z-50 flex w-[min(calc(100%-24px),380px)] -translate-x-1/2 items-center gap-3 rounded-[14px] border bg-white px-3.5 py-3 text-xs font-bold shadow-[0_14px_38px_rgba(15,23,42,0.16)]",
        isSuccess ? "border-blue-100 text-slate-800" : "border-red-100 text-red-800",
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
          isSuccess ? "bg-secondary text-primary" : "bg-red-50 text-red-600",
        )}
      >
        <BadgeCheck className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{alert.message}</span>
    </div>
  );
}

function AddPatientDialog({
  doctor,
  form,
  saving,
  slotStartsAt,
  onCancel,
  onChange,
  onConfirm,
}: {
  doctor: Doctor | null;
  form: AddPatientForm;
  saving: boolean;
  slotStartsAt: string;
  onCancel: () => void;
  onChange: <K extends keyof AddPatientForm>(key: K, value: AddPatientForm[K]) => void;
  onConfirm: () => void;
}) {
  const dictationTarget = doctor ? { doctorId: doctor.id } : {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[460px] rounded-[16px] border bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Add patient</p>
            <h2 className="mt-1 text-base font-bold text-slate-900">{formatFullDate(slotStartsAt)}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {doctor ? `${doctor.name} - ${doctor.specialty}` : "Doctor slot"}
            </p>
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border bg-white text-slate-500 transition hover:border-primary/45 hover:text-primary"
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Close add patient modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Patient name</span>
            <DictationInput
              className="h-9 rounded-[10px] px-2.5 text-xs"
              dictationTarget={dictationTarget}
              fieldId="add-patient-name"
              value={form.name}
              onValueChange={(value) => onChange("name", value)}
              placeholder="Patient full name"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Age</span>
              <Input
                className="h-9 rounded-[10px] px-2.5 text-xs"
                value={form.age}
                onChange={(event) => onChange("age", event.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                placeholder="34"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Gender</span>
              <select
                className="h-9 w-full rounded-[10px] border bg-white px-2.5 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                value={form.gender}
                onChange={(event) => onChange("gender", event.target.value as AddPatientForm["gender"])}
              >
                <option value="">Select</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Contact</span>
            <Input
              className="h-9 rounded-[10px] px-2.5 text-xs"
              value={form.phone}
              onChange={(event) => onChange("phone", event.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              placeholder="10 digit phone number"
            />
          </label>

          <div className="grid gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason</span>
            <DictationTextarea
              className="min-h-[82px] rounded-[10px] px-2.5 py-2 text-xs"
              dictationTarget={dictationTarget}
              fieldId="add-patient-visit-reason"
              value={form.visitReason}
              onValueChange={(value) => onChange("visitReason", value)}
              placeholder="Reason for visit"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button className="h-9 rounded-[11px] text-xs" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button className="h-9 rounded-[11px] text-xs" onClick={onConfirm} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add patient
          </Button>
        </div>
      </section>
    </div>
  );
}

function DeleteTestConfirmDialog({
  deleting,
  test,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  test: PendingTestDelete;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" disabled={deleting} onClick={onCancel} type="button" aria-label="Cancel delete test result" />
      <section className="relative w-full max-w-[420px] rounded-[14px] border bg-white p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-red-50 text-red-600">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900">Delete test result?</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              This will remove <span className="font-bold text-slate-700">{test.name}</span>
              {test.imageCount ? ` and ${test.imageCount} uploaded image${test.imageCount === 1 ? "" : "s"}` : ""}.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button className="h-9 rounded-[11px] px-4 text-xs" disabled={deleting} onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button className="h-9 rounded-[11px] bg-red-600 px-4 text-xs text-white hover:bg-red-700" disabled={deleting} onClick={onConfirm} type="button">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </Button>
        </div>
      </section>
    </div>
  );
}

function HistoryConversationDialog({
  conversation,
  dialog,
  onClose,
}: {
  conversation: ConversationPanelState;
  dialog: HistoryConversationDialogState;
  onClose: () => void;
}) {
  const busy = ["recording", "uploading", "uploaded", "transcribing", "labeling"].includes(conversation.status);
  const completed = conversation.status === "completed";
  const failed = conversation.status === "failed";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" onClick={onClose} type="button" aria-label="Close conversation transcript" />
      <section className="relative flex max-h-[88vh] w-full max-w-[760px] min-h-0 flex-col rounded-[14px] border bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]",
                busy && "bg-blue-50 text-blue-700",
                completed && "bg-emerald-50 text-emerald-700",
                failed && "bg-red-50 text-red-700",
                !busy && !completed && !failed && "bg-slate-100 text-slate-600",
              )}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">Patient Conversation</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {dialog.patientName} · {dialog.bookingCode} · {dialog.historyTitle}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                {conversation.message || "No completed conversation transcript loaded."}
                {conversation.updatedAt ? ` · ${formatFullDate(conversation.updatedAt)}` : ""}
              </p>
            </div>
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
            onClick={onClose}
            type="button"
            aria-label="Close conversation transcript"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {conversation.audioUrl ? (
            <div className="mb-3 rounded-[12px] border bg-[#fbfdff] p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-slate-100 text-slate-600">
                  <Mic className="h-3.5 w-3.5" />
                </div>
                <p className="text-xs font-bold text-slate-800">Session Recording</p>
              </div>
              <audio className="h-9 w-full" controls preload="metadata" src={conversation.audioUrl}>
                <track kind="captions" />
              </audio>
            </div>
          ) : null}

          {failed ? (
            <p className="rounded-[12px] border border-red-100 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">
              {conversation.error || "Conversation transcript failed."}
            </p>
          ) : null}

          {busy ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-[12px] border bg-[#fbfdff] p-4 text-center">
              <div>
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                <p className="mt-2 text-xs font-bold text-slate-700">{conversation.message || "Preparing transcript"}</p>
              </div>
            </div>
          ) : null}

          {completed && conversation.language ? (
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Language: {conversation.language}
            </p>
          ) : null}

          {completed && conversation.turns.length ? (
            <div className="space-y-2">
              {conversation.turns.map((turn, index) => (
                <div
                  key={`${turn.speaker}-${index}`}
                  className={cn(
                    "rounded-[12px] border px-3 py-2 text-xs leading-5",
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
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>
              ))}
            </div>
          ) : null}

          {completed && !conversation.turns.length && conversation.plainTranscript ? (
            <pre className="whitespace-pre-wrap rounded-[12px] border bg-[#fbfdff] p-3 text-xs leading-5 text-slate-700">
              {conversation.plainTranscript}
            </pre>
          ) : null}

          {completed && conversation.warnings.length ? (
            <div className="mt-3 rounded-[12px] border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              {conversation.warnings.join(" ")}
            </div>
          ) : null}

          {!busy && !completed && !failed ? (
            <p className="rounded-[12px] border bg-[#fbfdff] p-3 text-xs leading-5 text-slate-500">
              No completed conversation recording is available for this visit.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PatientVitalsCard({
  appointment,
  vitals,
  onChange,
  onSave,
}: {
  appointment: DoctorAppointment;
  vitals: typeof blankForm.vitals;
  onChange: (key: keyof typeof blankForm.vitals, value: string) => void;
  onSave: (vitals: typeof blankForm.vitals) => void;
}) {
  const [editingVital, setEditingVital] = useState<keyof typeof blankForm.vitals | null>(null);

  function commitVital(key: keyof typeof blankForm.vitals) {
    setEditingVital(null);
    onSave({ ...vitals, [key]: vitals[key] });
  }

  return (
    <section className="rounded-[14px] border bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
          <UserRound className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="break-words text-[14px] text-base font-bold leading-5 text-slate-900">{appointment.patient.name}</h3>
            <span className="rounded-full border border-blue-200 bg-secondary px-2 py-0.5 text-[11px] font-bold text-primary">
              {appointment.patient.age} yrs / {formatGender(appointment.patient.gender)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <VitalTile
          editing={editingVital === "bloodPressure"}
          label="Blood pressure"
          placeholder="120/80"
          value={vitals.bloodPressure}
          onBlur={() => commitVital("bloodPressure")}
          onChange={(value) => onChange("bloodPressure", value)}
          onEdit={() => setEditingVital("bloodPressure")}
        />
        <VitalTile
          editing={editingVital === "pulse"}
          label="Pulse"
          placeholder="78"
          value={vitals.pulse}
          onBlur={() => commitVital("pulse")}
          onChange={(value) => onChange("pulse", value.replace(/\D/g, ""))}
          onEdit={() => setEditingVital("pulse")}
        />
        <VitalTile
          editing={editingVital === "temperature"}
          label="Temperature"
          placeholder="98.6 F"
          value={vitals.temperature}
          onBlur={() => commitVital("temperature")}
          onChange={(value) => onChange("temperature", value)}
          onEdit={() => setEditingVital("temperature")}
        />
        <VitalTile
          editing={editingVital === "spo2"}
          label="SpO2"
          placeholder="99"
          value={vitals.spo2}
          onBlur={() => commitVital("spo2")}
          onChange={(value) => onChange("spo2", value.replace(/\D/g, ""))}
          onEdit={() => setEditingVital("spo2")}
        />
        <VitalTile
          editing={editingVital === "weight"}
          label="Weight"
          placeholder="68 kg"
          value={vitals.weight}
          onBlur={() => commitVital("weight")}
          onChange={(value) => onChange("weight", value)}
          onEdit={() => setEditingVital("weight")}
        />
      </div>
    </section>
  );
}

function VitalTile({
  editing,
  label,
  placeholder,
  value,
  onBlur,
  onChange,
  onEdit,
}: {
  editing: boolean;
  label: string;
  placeholder: string;
  value: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  onEdit: () => void;
}) {
  if (editing) {
    return (
      <Field label={label}>
        <Input
          autoFocus
          className="h-7 rounded-[10px] px-2.5 mt-1 text-xs font-bold"
          value={value}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
        />
      </Field>
    );
  }

  return (
    <button
      className="grid min-h-[40px] rounded-[12px] border bg-[#fbfdff] px-3 py-2 text-left transition hover:border-primary/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15"
      onClick={onEdit}
      type="button"
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <span className={cn("mt-1 text-[12px] font-bold text-slate-800", !value && "text-slate-300")}>
        {value || "Not recorded"}
      </span>
    </button>
  );
}

function ClinicalNotesPanel({
  appointmentId,
  form,
  notes,
  saveStatus,
  onBlur,
  onChange,
  onRetry,
  onVerify,
}: {
  appointmentId: string;
  form: typeof blankForm;
  notes: ClinicalNotesSnapshot;
  saveStatus: Record<ClinicalNoteField, ClinicalNoteSaveStatus>;
  onBlur: (field: ClinicalNoteField) => void;
  onChange: (key: ClinicalNoteField, value: string) => void;
  onRetry: () => void;
  onVerify: (field: ClinicalNoteField) => void;
}) {
  const dictationTarget = { appointmentId };
  const generationBusy = notes.generationStatus === "PENDING" || notes.generationStatus === "PROCESSING";

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[14px] border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <PanelTitle icon={ClipboardList} title="Clinical Note" subtitle="Observations, diagnosis, and follow-up" />
        {generationBusy ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating notes
          </span>
        ) : null}
        {notes.generationStatus === "FAILED" ? (
          <button
            className="shrink-0 rounded-[9px] border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100"
            onClick={onRetry}
            type="button"
          >
            Retry AI
          </button>
        ) : null}
      </div>
      {notes.generationStatus === "FAILED" && notes.generationError ? (
        <p className="mt-2 rounded-[9px] border border-red-100 bg-red-50 px-2 py-1.5 text-[10px] font-semibold text-red-700">
          {notes.generationError}
        </p>
      ) : null}
      <div className="mt-3 grid min-h-0 flex-1 grid-rows-3 gap-3">
        <ClinicalNoteEditor
          dictationTarget={dictationTarget}
          field="observations"
          fieldId="clinical-observations"
          label="Current observations"
          notes={notes}
          placeholder="Examination findings, patient state, red flags"
          saveStatus={saveStatus.observations}
          value={form.observations}
          onBlur={onBlur}
          onChange={onChange}
          onVerify={onVerify}
        />
        <ClinicalNoteEditor
          dictationTarget={dictationTarget}
          field="diagnosis"
          fieldId="clinical-diagnosis"
          label="Diagnosis"
          notes={notes}
          placeholder="Working diagnosis or differential"
          saveStatus={saveStatus.diagnosis}
          value={form.diagnosis}
          onBlur={onBlur}
          onChange={onChange}
          onVerify={onVerify}
        />
        <ClinicalNoteEditor
          dictationTarget={dictationTarget}
          field="followUpNotes"
          fieldId="clinical-follow-up"
          label="Follow-up notes"
          notes={notes}
          placeholder="Review date, warning signs, reports to bring"
          saveStatus={saveStatus.followUpNotes}
          value={form.followUpNotes}
          onBlur={onBlur}
          onChange={onChange}
          onVerify={onVerify}
        />
      </div>
    </section>
  );
}

function ClinicalNoteEditor({
  dictationTarget,
  field,
  fieldId,
  label,
  notes,
  placeholder,
  saveStatus,
  value,
  onBlur,
  onChange,
  onVerify,
}: {
  dictationTarget: DictationTarget;
  field: ClinicalNoteField;
  fieldId: string;
  label: string;
  notes: ClinicalNotesSnapshot;
  placeholder: string;
  saveStatus: ClinicalNoteSaveStatus;
  value: string;
  onBlur: (field: ClinicalNoteField) => void;
  onChange: (field: ClinicalNoteField, value: string) => void;
  onVerify: (field: ClinicalNoteField) => void;
}) {
  const unverified = notes.unverified[field];

  return (
    <Field className="flex min-h-0 flex-col" label={label}>
      <DictationTextarea
        className={cn(
          "min-h-[90px] flex-1 rounded-[10px] px-2.5 py-2 text-xs",
          unverified && "border-amber-200 bg-amber-50/30",
        )}
        dictationTarget={dictationTarget}
        fieldId={fieldId}
        value={value}
        onBlur={() => onBlur(field)}
        onValueChange={(nextValue) => onChange(field, nextValue)}
        placeholder={placeholder}
      />
      <div className="mt-1 flex min-h-5 items-center justify-end gap-2">
        {unverified ? (
          <>
            <span className="text-[10px] font-bold text-amber-700">Unverified AI text</span>
            <button
              className="inline-flex min-h-7 items-center justify-center gap-1 rounded-[8px] bg-emerald-600 px-2 py-1 text-[10px] font-bold leading-none text-white hover:bg-emerald-700"
              onClick={() => onVerify(field)}
              type="button"
            >
              <BadgeCheck className="h-3 w-3 shrink-0" />
              Verify
            </button>
          </>
        ) : saveStatus !== "idle" ? (
          <span
            className={cn(
              "text-[10px] font-bold",
              saveStatus === "error" ? "text-red-600" : saveStatus === "saved" ? "text-emerald-600" : "text-slate-400",
            )}
          >
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved · Verified" : "Save failed"}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

function TestResultsPanel({
  appointment,
  deletingTestId,
  testResultForm,
  saving,
  onChange,
  onDelete,
  onSave,
}: {
  appointment: DoctorAppointment;
  deletingTestId: string;
  testResultForm: { testName: string };
  saving: boolean;
  onChange: (key: "testName", value: string) => void;
  onDelete: (testResult: ClinicalTestResult) => void;
  onSave: (files: FileList | null) => Promise<boolean>;
}) {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const testResults = appointment.clinicalRecord?.testResults ?? [];
  const hasRequiredFields = Boolean(testResultForm.testName.trim() && selectedFiles?.length);
  const dictationTarget = { appointmentId: appointment.id };

  async function handleSave() {
    const saved = await onSave(selectedFiles);
    if (saved) {
      setSelectedFiles(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section className="rounded-[14px] border bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle icon={FlaskConical} title="Tests" subtitle="Upload reports, extract results, and use them in patient analysis" />
        <Button
          className="h-9 rounded-[12px] bg-blue-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving || !hasRequiredFields}
          onClick={handleSave}
          type="button"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Extract
        </Button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="rounded-[12px] border bg-[#fbfdff] p-2.5">
          <div className="grid gap-2">
            <Field label="Test name">
              <DictationInput
                className="h-9 rounded-[10px] px-2.5 text-xs"
                dictationTarget={dictationTarget}
                fieldId="test-name"
                value={testResultForm.testName}
                onValueChange={(value) => onChange("testName", value)}
                placeholder="CBC, LFT, X-ray report, culture..."
              />
            </Field>
            <Field label="Result images">
              <button
                className="flex min-h-[82px] w-full cursor-pointer flex-col items-center justify-center rounded-[12px] border border-dashed bg-white px-3 py-3 text-center transition hover:border-blue-200 hover:bg-blue-50"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <ImageIcon className="h-5 w-5 text-blue-600" />
                <span className="mt-1 text-xs font-bold text-slate-700">
                  {selectedFiles?.length ? `${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"} selected` : "Choose report images"}
                </span>
              </button>
              <input
                ref={fileInputRef}
                className="hidden"
                tabIndex={-1}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => setSelectedFiles(event.target.files)}
              />
            </Field>
          </div>
        </div>

        <div className="min-w-0">
          {testResults.length ? (
            <div className="space-y-2">
              {testResults.map((testResult) => (
                <TestResultCard
                  key={testResult.id}
                  deleting={deletingTestId === testResult.id}
                  expanded={expandedTestId === testResult.id}
                  testResult={testResult}
                  onDelete={() => onDelete(testResult)}
                  onToggle={() => setExpandedTestId((current) => (current === testResult.id ? null : testResult.id))}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[180px] items-center justify-center rounded-[12px] border border-dashed bg-[#fbfdff] p-4 text-center">
              <div className="max-w-[300px]">
                <FlaskConical className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-xs font-bold text-slate-600">No test results uploaded</p>
                <p className="mt-1 text-xs leading-4 text-slate-400">
                  Extracted test rows will appear here and will be included in patient analysis after extraction succeeds.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TestResultCard({
  deleting,
  expanded,
  testResult,
  onDelete,
  onToggle,
}: {
  deleting: boolean;
  expanded: boolean;
  testResult: ClinicalTestResult;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const observations = testResult.observations ?? [];
  const completed = testResult.extractionStatus === "COMPLETED";
  const [previewImage, setPreviewImage] = useState<ClinicalTestResult["images"][number] | null>(null);

  return (
    <>
      <article className="rounded-[12px] border bg-white">
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-[12px] transition",
            expanded && "rounded-b-none border-b bg-slate-50",
          )}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] px-3 py-2 text-left transition hover:bg-blue-50"
            onClick={onToggle}
            type="button"
            aria-expanded={expanded}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-primary">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                {completed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                ) : testResult.extractionStatus === "FAILED" ? (
                  <X className="h-3.5 w-3.5 shrink-0 text-red-600" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                )}
                <h4 className="truncate text-xs font-bold text-slate-800">{testResult.reportTitle || testResult.testName}</h4>
              </div>
              <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">
                {[
                  testResult.labName || null,
                  testResult.reportedAtText || formatShortDate(testResult.createdAt),
                  `${observations.length} result${observations.length === 1 ? "" : "s"}`,
                  `${testResult.images.length} image${testResult.images.length === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </p>
            </div>
            <ChevronRight className={cn("h-4 w-4 shrink-0 text-slate-400 transition", expanded && "rotate-90 text-blue-600")} />
          </button>
          <span
            className={cn(
              "hidden shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase sm:inline-flex",
              completed && "border-emerald-100 bg-emerald-50 text-emerald-700",
              testResult.extractionStatus === "FAILED" && "border-red-100 bg-red-50 text-red-700",
              testResult.extractionStatus === "PENDING" && "border-amber-100 bg-amber-50 text-amber-700",
            )}
          >
            {testResult.extractionStatus}
          </span>
          <button
            className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={deleting}
            aria-label="Delete test result"
            onClick={onDelete}
            type="button"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>

        {expanded ? (
          <div className="p-3">
            {testResult.overallImpression ? (
              <p className="rounded-[10px] border bg-[#fbfdff] px-2.5 py-2 text-xs leading-5 text-slate-700">
                {testResult.overallImpression}
              </p>
            ) : null}

            {testResult.extractionError ? (
              <p className="rounded-[10px] border border-red-100 bg-red-50 px-2.5 py-2 text-xs font-semibold leading-5 text-red-700">
                {testResult.extractionError}
              </p>
            ) : null}

            {observations.length ? (
              <div className="mt-2 overflow-x-auto rounded-[10px] border">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[210px_130px_90px_150px_90px_1fr] border-b bg-slate-50 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
                    {["Observation", "Value", "Unit", "Reference", "Flag", "Interpretation"].map((heading) => (
                      <div key={heading} className="border-r px-2 py-1.5 last:border-r-0">
                        {heading}
                      </div>
                    ))}
                  </div>
                  {observations.slice(0, 16).map((item, index) => (
                    <div key={`${testResult.id}-${index}`} className="grid grid-cols-[210px_130px_90px_150px_90px_1fr] border-b text-xs last:border-b-0">
                      <TableCell>{item.name || "-"}</TableCell>
                      <TableCell>{item.value || "-"}</TableCell>
                      <TableCell>{item.unit || "-"}</TableCell>
                      <TableCell>{item.referenceRange || "-"}</TableCell>
                      <TableCell>
                        <span className={cn("font-bold", isAbnormalFlag(item.flag) ? "text-amber-700" : "text-slate-600")}>{item.flag || "-"}</span>
                      </TableCell>
                      <TableCell>{item.interpretation || "-"}</TableCell>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {testResult.images.map((image) => (
                <button
                  key={image.id}
                  className="group flex w-[118px] flex-col overflow-hidden rounded-[10px] border bg-slate-50 text-left transition hover:border-blue-200 hover:bg-blue-50"
                  onClick={() => setPreviewImage(image)}
                  type="button"
                >
                  <span className="flex h-[78px] w-full items-center justify-center bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={image.originalName}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      src={image.imageUrl}
                    />
                  </span>
                  <span className="flex min-w-0 items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-slate-500 group-hover:text-blue-700">
                    <ImageIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{image.originalName}</span>
                  </span>
                </button>
              ))}
            </div>

            {testResult.extractionWarnings.length ? (
              <div className="mt-2 space-y-1">
                {testResult.extractionWarnings.slice(0, 3).map((warning, index) => (
                  <p key={`${testResult.id}-warning-${index}`} className="rounded-[9px] border border-amber-100 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      {previewImage ? <TestImagePreview image={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </>
  );
}

function TestImagePreview({
  image,
  onClose,
}: {
  image: ClinicalTestResult["images"][number];
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" onClick={onClose} type="button" aria-label="Close image preview" />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[14px] border border-white/15 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">{image.originalName}</p>
            <p className="text-xs font-semibold text-slate-400">{formatFileSize(image.sizeBytes)}</p>
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            onClick={onClose}
            type="button"
            aria-label="Close image preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={image.originalName} className="max-h-[78vh] max-w-full rounded-[10px] object-contain shadow-sm" src={image.imageUrl} />
        </div>
      </div>
    </div>
  );
}

function PrescriptionPanel({
  appointment,
  form,
  prescriptions,
  onAdd,
  onChange,
  onRemove,
}: {
  appointment: DoctorAppointment;
  form: typeof blankForm;
  prescriptions: Prescription[];
  onAdd: () => void;
  onChange: (index: number, key: keyof Prescription, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="rounded-[14px] border bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle icon={Pill} title="Prescription" subtitle="Medicines, dosage, duration, and instructions" />
        <div className="flex shrink-0 gap-2">
          <Button
            className="h-9 rounded-[12px] border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            size="sm"
            variant="outline"
            onClick={() => printPrescription(appointment, form)}
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
            Print Rx
          </Button>
          <Button
            className="h-9 rounded-[12px] bg-blue-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
            size="sm"
            onClick={onAdd}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-[10px] border">
        <div className="min-w-[1100px]">
          <div className={cn(prescriptionGridClass, "border-b bg-slate-50 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500")}>
            {["Medicine name", "Dose", "Route", "When", "Food", "Duration", "Quantity", "Instructions", ""].map((heading) => (
              <div key={heading || "action"} className="border-r px-2 py-1.5 last:border-r-0">
                {heading}
              </div>
            ))}
          </div>
          {prescriptions.map((item, index) => (
            <div
              key={index}
              className={cn(prescriptionGridClass, "border-b bg-white last:border-b-0")}
            >
              <TableCell>
                <PrescriptionTableInput value={item.medicine} onValueChange={(value) => onChange(index, "medicine", value)} placeholder="paracetamol" />
              </TableCell>
              <TableCell>
                <PrescriptionTableInput value={item.dosage} onValueChange={(value) => onChange(index, "dosage", value)} placeholder="500 mg" />
              </TableCell>
              <TableCell>
                <PrescriptionCombobox
                  options={routeOptions}
                  placeholder="Type or select route"
                  value={item.route}
                  onChange={(value) => onChange(index, "route", value)}
                />
              </TableCell>
              <TableCell>
                <PrescriptionCombobox
                  options={timingOptions}
                  placeholder="Type or select time"
                  value={item.frequency}
                  onChange={(value) => onChange(index, "frequency", value)}
                />
              </TableCell>
              <TableCell>
                <PrescriptionCombobox
                  options={mealTimingOptions}
                  placeholder="Type or select food"
                  value={item.mealTiming}
                  onChange={(value) => onChange(index, "mealTiming", value)}
                />
              </TableCell>
              <TableCell>
                <PrescriptionTableInput value={item.duration} onValueChange={(value) => onChange(index, "duration", value)} placeholder="5 days" />
              </TableCell>
              <TableCell>
                <PrescriptionTableInput value={item.quantity} onValueChange={(value) => onChange(index, "quantity", value)} placeholder="10 tabs" />
              </TableCell>
              <TableCell>
                <PrescriptionTableInput value={item.instructions} onValueChange={(value) => onChange(index, "instructions", value)} placeholder="Safety notes" />
              </TableCell>
              <div className="flex items-center justify-center px-1.5 py-1.5">
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-[8px] text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  onClick={() => onRemove(index)}
                  type="button"
                  aria-label="Remove medicine"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


function PatientHistoryCard({
  appointment,
  historyForm,
  saving,
  onAddHistory,
  onDeleteHistory,
  onOpenConversation,
  onHistoryChange,
}: {
  appointment: DoctorAppointment;
  historyForm: { title: string; detail: string };
  saving: boolean;
  onAddHistory: () => Promise<boolean>;
  onDeleteHistory: (historyId: string) => void;
  onOpenConversation: (entry: HistoryEntry, appointment: DoctorAppointment) => void;
  onHistoryChange: (key: "title" | "detail", value: string) => void;
}) {
  const [isAddingHistory, setIsAddingHistory] = useState(false);
  const hasRequiredHistoryFields = Boolean(historyForm.title.trim() && historyForm.detail.trim());
  const dictationTarget = { appointmentId: appointment.id };
  const sortedMedicalHistory = [...appointment.patient.medicalHistory].sort(
    (firstEntry, secondEntry) => Date.parse(secondEntry.recordedAt) - Date.parse(firstEntry.recordedAt),
  );

  function collapseHistoryForm() {
    onHistoryChange("title", "");
    onHistoryChange("detail", "");
    setIsAddingHistory(false);
  }

  async function handleHistoryAction() {
    if (!hasRequiredHistoryFields) {
      collapseHistoryForm();
      return;
    }

    const saved = await onAddHistory();
    if (saved) {
      setIsAddingHistory(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-[14px] border bg-white p-3 shadow-sm">
      <PanelTitle icon={FileText} title="Patient History" subtitle="Known clinical context" />
      <div className="mt-3 max-h-[326px] min-h-0 space-y-2 overflow-y-auto pr-1">
        {sortedMedicalHistory.length ? (
          sortedMedicalHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex w-full items-center gap-3 rounded-[12px] border bg-[#fbfdff] p-2.5 text-left transition hover:border-blue-200 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              onClick={() => onOpenConversation(entry, appointment)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenConversation(entry, appointment);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="min-w-0 flex-1">
                <h4 className="break-words text-xs font-bold text-slate-800">{entry.title}</h4>
                <p className="mt-1.5 text-xs leading-4 text-slate-600">{entry.detail}</p>
              </div>
              <div className="flex min-h-[58px] w-[72px] shrink-0 flex-col items-end justify-between">
                <p className="text-right text-[11px] font-semibold text-slate-400">{formatShortDate(entry.recordedAt)}</p>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-[8px] text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={saving}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteHistory(entry.id);
                  }}
                  type="button"
                  aria-label="Delete patient history"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-[12px] border bg-[#fbfdff] p-2.5 text-xs font-medium text-slate-500">No stored history.</p>
        )}
      </div>
      {isAddingHistory ? (
        <div className="mt-3 shrink-0 rounded-[12px] border bg-[#fbfdff] p-2.5">
          <div className="grid gap-2">
            <DictationInput className="h-9 rounded-[10px] px-2.5 text-xs" dictationTarget={dictationTarget} fieldId="history-title" value={historyForm.title} onValueChange={(value) => onHistoryChange("title", value)} placeholder="Title" />
            <DictationTextarea
              className="min-h-16 rounded-[10px] px-2.5 py-2 text-xs"
              dictationTarget={dictationTarget}
              fieldId="history-detail"
              value={historyForm.detail}
              onValueChange={(value) => onHistoryChange("detail", value)}
              placeholder="Details, severity, reaction, date, current status"
            />
            <Button className="h-9 rounded-[11px] text-xs" disabled={saving} onClick={handleHistoryAction} type="button" variant={hasRequiredHistoryFields ? "secondary" : "outline"}>
              {hasRequiredHistoryFields ? (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add History
                </>
              ) : (
                "Cancel"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3 h-9 w-full shrink-0 rounded-[11px] text-xs" disabled={saving} onClick={() => setIsAddingHistory(true)} type="button" variant="secondary">
          <Plus className="h-3.5 w-3.5" />
          Add History
        </Button>
      )}
    </section>
  );
}

function DictationInput({
  className,
  dictationTarget,
  fieldId,
  placeholder,
  value,
  onValueChange,
}: {
  className?: string;
  dictationTarget: DictationTarget;
  fieldId: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  function rememberSelection() {
    const input = inputRef.current;
    if (!input) return;
    selectionRef.current = {
      start: input.selectionStart ?? value.length,
      end: input.selectionEnd ?? value.length,
    };
  }

  function insertTranscript(text: string) {
    const input = inputRef.current;
    const selection = selectionRef.current ?? {
      start: input?.selectionStart ?? value.length,
      end: input?.selectionEnd ?? value.length,
    };
    const nextValue = insertTextAtSelection(value, text, selection.start, selection.end);
    const nextCursor = selection.start + normalizeTranscriptForInsertion(value, text, selection.start).length;
    onValueChange(nextValue);
    window.setTimeout(() => inputRef.current?.setSelectionRange(nextCursor, nextCursor), 0);
  }

  return (
    <DictationShell dictationTarget={dictationTarget} fieldId={fieldId} onTranscript={insertTranscript}>
      {({ control, recording, transcribing, error }) => (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              ref={inputRef}
              className={cn("min-w-0 flex-1", className)}
              value={value}
              onBlur={rememberSelection}
              onChange={(event) => onValueChange(event.target.value)}
              onClick={rememberSelection}
              onKeyUp={rememberSelection}
              onSelect={rememberSelection}
              placeholder={placeholder}
            />
            {control({ compact: false })}
          </div>
          {error ? <DictationError message={error} /> : null}
          {recording || transcribing ? <DictationStatus recording={recording} transcribing={transcribing} /> : null}
        </div>
      )}
    </DictationShell>
  );
}

function DictationTextarea({
  className,
  dictationTarget,
  fieldId,
  onBlur,
  placeholder,
  value,
  onValueChange,
}: {
  className?: string;
  dictationTarget: DictationTarget;
  fieldId: string;
  onBlur?: () => void;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  function rememberSelection() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart ?? value.length,
      end: textarea.selectionEnd ?? value.length,
    };
  }

  function insertTranscript(text: string) {
    const textarea = textareaRef.current;
    const selection = selectionRef.current ?? {
      start: textarea?.selectionStart ?? value.length,
      end: textarea?.selectionEnd ?? value.length,
    };
    const nextValue = insertTextAtSelection(value, text, selection.start, selection.end);
    const nextCursor = selection.start + normalizeTranscriptForInsertion(value, text, selection.start).length;
    onValueChange(nextValue);
    window.setTimeout(() => textareaRef.current?.setSelectionRange(nextCursor, nextCursor), 0);
  }

  return (
    <DictationShell dictationTarget={dictationTarget} fieldId={fieldId} onTranscript={insertTranscript}>
      {({ control, recording, transcribing, error }) => (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-h-0 min-w-0 flex-1 items-center gap-1.5">
            <Textarea
              ref={textareaRef}
              className={cn("min-w-0 flex-1", className)}
              value={value}
              onBlur={() => {
                rememberSelection();
                onBlur?.();
              }}
              onChange={(event) => onValueChange(event.target.value)}
              onClick={rememberSelection}
              onKeyUp={rememberSelection}
              onSelect={rememberSelection}
              placeholder={placeholder}
            />
            {control({ compact: false })}
          </div>
          {error ? <DictationError message={error} /> : null}
          {recording || transcribing ? <DictationStatus recording={recording} transcribing={transcribing} /> : null}
        </div>
      )}
    </DictationShell>
  );
}

function PrescriptionTableInput({
  placeholder,
  value,
  onValueChange,
}: {
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <input
      className={tableInputClass}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
    />
  );
}

function DictationShell({
  children,
  dictationTarget,
  fieldId,
  onTranscript,
}: {
  children: (state: {
    control: (options: { compact: boolean }) => React.ReactNode;
    error: string;
    recording: boolean;
    transcribing: boolean;
  }) => React.ReactNode;
  dictationTarget: DictationTarget;
  fieldId: string;
  onTranscript: (text: string) => void;
}) {
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const instanceId = useId();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const hasTarget = Boolean(dictationTarget.appointmentId || dictationTarget.doctorId);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    clearStopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [clearStopTimer]);

  useEffect(
    () => {
      function handleDictationStart(event: Event) {
        const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
        if (detail?.instanceId !== instanceId) {
          stopRecording();
        }
      }

      window.addEventListener("doctor-dictation-start", handleDictationStart);

      return () => {
        window.removeEventListener("doctor-dictation-start", handleDictationStart);
        clearStopTimer();
        streamRef.current?.getTracks().forEach((track) => track.stop());
      };
    },
    [clearStopTimer, instanceId, stopRecording],
  );

  async function startRecording() {
    if (!hasTarget || recording || transcribing) return;
    setError("");
    window.dispatchEvent(new CustomEvent("doctor-dictation-start", { detail: { instanceId } }));

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        void transcribeChunks(mimeType || recorder.mimeType || "audio/webm");
      };

      recorder.start();
      stopTimerRef.current = window.setTimeout(stopRecording, dictationMaxDurationSeconds * 1000);
      setRecording(true);
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : "Microphone permission was denied.");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  async function transcribeChunks(mimeType: string) {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) {
      setError("No speech was recorded.");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const payload = new FormData();
    payload.set("fieldId", fieldId);
    payload.set("durationSeconds", String(dictationMaxDurationSeconds));
    if (dictationTarget.appointmentId) payload.set("appointmentId", dictationTarget.appointmentId);
    if (dictationTarget.doctorId) payload.set("doctorId", dictationTarget.doctorId);
    payload.set("file", blob, `doctor-dictation.${mimeType.includes("wav") ? "wav" : "webm"}`);
    setTranscribing(true);

    try {
      const response = await fetch("/api/doctor-transcription", {
        method: "POST",
        body: payload,
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.message ?? "Could not transcribe recording.");
        return;
      }

      if (typeof body.text === "string" && body.text.trim()) {
        onTranscript(body.text.trim());
      } else {
        setError("No speech was detected.");
      }
    } catch {
      setError("Could not reach the transcription service.");
    } finally {
      setTranscribing(false);
    }
  }

  function renderControl({ compact }: { compact: boolean }) {
    const label = recording ? "Stop recording" : transcribing ? "Transcribing" : "Start dictation";

    return (
      <button
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[9px] border bg-white text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "h-6 w-6" : "h-9 w-9",
          recording && "border-red-200 bg-red-50 text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700",
        )}
        disabled={!hasTarget || transcribing}
        onClick={recording ? stopRecording : startRecording}
        title={label}
        type="button"
        aria-label={label}
      >
        {transcribing ? (
          <Loader2 className={cn("animate-spin", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
        ) : recording ? (
          <Square className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
        ) : (
          <Mic className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
        )}
      </button>
    );
  }

  return <>{children({ control: renderControl, error, recording, transcribing })}</>;
}

function DictationStatus({ recording, transcribing }: { recording: boolean; transcribing: boolean }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
      {recording ? "Recording" : transcribing ? "Transcribing" : ""}
    </p>
  );
}

function DictationError({ message }: { message: string }) {
  return <p className="text-[11px] font-semibold leading-4 text-red-600">{message}</p>;
}

function getPreferredAudioMimeType() {
  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav"];
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "webm";
}

function insertTextAtSelection(value: string, transcript: string, start: number, end: number) {
  return `${value.slice(0, start)}${normalizeTranscriptForInsertion(value, transcript, start)}${value.slice(end)}`;
}

function normalizeTranscriptForInsertion(value: string, transcript: string, start: number) {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const needsLeadingSpace = start > 0 && !/\s$/.test(value.slice(0, start));
  return `${needsLeadingSpace ? " " : ""}${trimmed}`;
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

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("block space-y-1.5", className)}>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      {children}
    </div>
  );
}

const tableInputClass =
  "h-8 w-full min-w-0 rounded-none bg-transparent px-0 text-xs font-semibold text-slate-800 outline-none placeholder:text-slate-300";
const prescriptionGridClass =
  "grid w-[1100px] grid-cols-[180px_100px_86px_150px_110px_100px_100px_230px_44px]";

function TableCell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 items-center border-r px-2 py-1.5 last:border-r-0">{children}</div>;
}

function PrescriptionCombobox({
  options,
  placeholder,
  value,
  onChange,
}: {
  options: string[];
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();

  return (
    <>
      <input
        aria-label={placeholder}
        autoComplete="off"
        className="h-8 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-1.5 text-xs font-semibold text-slate-800 outline-none transition hover:border-slate-200 hover:bg-white focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15"
        list={listId}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "blue" | "green" | "slate" }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border px-2 py-1.5",
        tone === "blue" && "border-blue-100 bg-blue-50 text-blue-700",
        tone === "green" && "border-emerald-100 bg-emerald-50 text-emerald-700",
        tone === "slate" && "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      <p className="text-base font-bold leading-5">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em]">{label}</p>
    </div>
  );
}

function StatusPill({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[10px] font-bold",
        status === "CONFIRMED" && "border-blue-100 bg-blue-50 text-blue-700",
        status === "IN_PROGRESS" && "border-emerald-100 bg-emerald-50 text-emerald-700",
        status === "COMPLETED" && "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {status === "COMPLETED" ? <BadgeCheck className="h-3 w-3" /> : null}
      {status.replace("_", " ")}
    </span>
  );
}

function EmptyPanel() {
  return (
    <div className="flex min-h-[170px] items-center justify-center rounded-[14px] border border-dashed bg-white p-4 text-center">
      <div>
        <HeartPulse className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-2 text-xs font-bold text-slate-600">No appointment selected</p>
        <p className="mt-1 text-xs text-slate-400">Choose a patient to begin consultation.</p>
      </div>
    </div>
  );
}

function fromRecord(record: ClinicalRecord | null) {
  if (!record) {
    return {
      ...blankForm,
      vitals: { ...blankForm.vitals },
      prescriptions: [{ ...blankPrescription }],
    };
  }
  return {
    diagnosis: combineClinicalNote(record.diagnosis, record.diagnosisAiDraft),
    observations: combineClinicalNote(record.observations, record.observationsAiDraft),
    followUpNotes: combineClinicalNote(record.followUpNotes, record.followUpNotesAiDraft),
    vitals: record.vitals,
    prescriptions: record.prescriptions.length
      ? record.prescriptions.map((item) => ({
          ...item,
          frequency: timingOptions.includes(item.frequency) ? item.frequency : item.timing || item.frequency,
          timing: "",
        }))
      : [{ ...blankPrescription }],
  };
}

function snapshotFromRecord(record: ClinicalRecord | null): ClinicalNotesSnapshot {
  if (!record) return blankClinicalNotesSnapshot;

  return {
    diagnosis: combineClinicalNote(record.diagnosis, record.diagnosisAiDraft),
    observations: combineClinicalNote(record.observations, record.observationsAiDraft),
    followUpNotes: combineClinicalNote(record.followUpNotes, record.followUpNotesAiDraft),
    unverified: {
      diagnosis: Boolean(record.diagnosisAiDraft),
      observations: Boolean(record.observationsAiDraft),
      followUpNotes: Boolean(record.followUpNotesAiDraft),
    },
    generationStatus: record.clinicalNotesGenerationStatus,
    generationError: record.clinicalNotesGenerationError,
    generatedAt: record.clinicalNotesGeneratedAt,
    draftVersion: record.clinicalNotesDraftVersion,
  };
}

function hydrateClinicalNotes(appointments: DoctorAppointment[]) {
  return appointments.reduce<Record<string, ClinicalNotesSnapshot>>((next, appointment) => {
    next[appointment.id] = snapshotFromRecord(appointment.clinicalRecord);
    return next;
  }, {});
}

function combineClinicalNote(verified: string, aiDraft: string) {
  return [verified.trim(), aiDraft.trim()].filter(Boolean).join("\n\n");
}

function hydrateCopilotStates(
  appointments: DoctorAppointment[],
  current: Record<string, CopilotState>,
): Record<string, CopilotState> {
  const next = { ...current };

  appointments.forEach((appointment) => {
    if (current[appointment.id]?.status === "loading") return;

    if (!appointment.aiAnalysis) {
      next[appointment.id] = blankCopilotState;
      return;
    }

    next[appointment.id] = {
      status: "ready",
      mode: appointment.aiAnalysis.mode,
      result: {
        summary: appointment.aiAnalysis.summary,
        vitalsAnalysis: appointment.aiAnalysis.vitalsAnalysis,
        historyAnalysis: appointment.aiAnalysis.historyAnalysis,
        riskFlags: appointment.aiAnalysis.riskFlags,
        suggestedQuestions: appointment.aiAnalysis.suggestedQuestions,
      },
      error: "",
    };
  });

  return next;
}

function mapConversationResponse(conversation: NonNullable<VisitConversationApiResponse["conversation"]>): ConversationPanelState {
  const statusMap: Record<NonNullable<VisitConversationApiResponse["conversation"]>["status"], ConversationPanelState["status"]> = {
    UPLOADED: "uploaded",
    TRANSCRIBING: "transcribing",
    LABELING: "labeling",
    COMPLETED: "completed",
    FAILED: "failed",
  };
  const status = statusMap[conversation.status] ?? "idle";

  return {
    status,
    message: formatConversationStatus(status),
    error: conversation.errorMessage,
    id: conversation.id,
    turns: conversation.turns ?? [],
    warnings: conversation.warnings ?? [],
    language: conversation.language,
    plainTranscript: conversation.plainTranscript,
    audioUrl: conversation.audioUrl,
    updatedAt: conversation.updatedAt,
  };
}

function formatConversationStatus(status: ConversationPanelState["status"]) {
  const labels: Record<ConversationPanelState["status"], string> = {
    idle: "",
    recording: "Recording conversation",
    uploading: "Uploading recording",
    uploaded: "Waiting to transcribe",
    transcribing: "Transcribing audio",
    labeling: "Identifying speakers",
    completed: "Transcript ready",
    failed: "Transcript failed",
  };

  return labels[status];
}

function printPrescription(appointment: DoctorAppointment, form: typeof blankForm) {
  const medicines = form.prescriptions.filter((item) => item.medicine.trim());
  const printWindow = window.open("", "_blank", "width=980,height=1200");
  if (!printWindow) return;

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(appointment.bookingCode)} Prescription</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; background: #eef3f8; color: #172033; font-family: Arial, Helvetica, sans-serif; }
          .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff; padding: 18mm; }
          .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #2563eb; padding-bottom: 18px; }
          .brand { display: flex; gap: 14px; align-items: center; }
          .logo { width: 54px; height: 54px; border-radius: 16px; background: #2563eb; color: #fff; display: grid; place-items: center; font-size: 28px; font-weight: 800; }
          h1, h2, h3, p { margin: 0; }
          h1 { font-size: 24px; line-height: 1.15; }
          .muted { color: #64748b; }
          .caps { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
          .doctor { text-align: right; font-size: 13px; line-height: 1.55; }
          .grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 14px; margin-top: 18px; }
          .grid.single { grid-template-columns: 1fr; }
          .box { border: 1px solid #dbe5f3; border-radius: 14px; padding: 14px; background: #fbfdff; }
          .box h2 { font-size: 15px; margin-bottom: 10px; }
          .line { display: grid; grid-template-columns: 125px 1fr; gap: 10px; padding: 5px 0; font-size: 13px; }
          .label { color: #64748b; font-weight: 700; }
          .value { font-weight: 800; overflow-wrap: anywhere; }
          .patient-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
          .patient-field { min-width: 0; }
          .patient-label { color: #64748b; display: block; font-size: 11px; font-weight: 800; margin-bottom: 4px; }
          .patient-value { color: #172033; display: block; font-size: 13px; font-weight: 900; overflow-wrap: anywhere; }
          .section { margin-top: 18px; }
          .section h2 { font-size: 16px; margin-bottom: 10px; color: #172033; }
          .rx-sheet { border: 1px solid #dbe5f3; border-radius: 16px; overflow: hidden; background: #ffffff; }
          .rx-head { display: grid; grid-template-columns: minmax(0, 1fr) 110px 140px; gap: 12px; background: #eff6ff; color: #1d4ed8; padding: 11px 14px; font-size: 10px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
          .rx-head span:nth-child(2), .rx-head span:nth-child(3) { text-align: center; }
          .rx-empty { padding: 18px; color: #64748b; font-size: 13px; font-weight: 700; }
          .rx-item { padding: 15px 14px 14px; border-top: 1px solid #dbe5f3; break-inside: avoid; }
          .rx-item:first-child { border-top: 0; }
          .rx-main { display: grid; grid-template-columns: minmax(0, 1fr) 110px 140px; gap: 12px; align-items: start; }
          .rx-medicine { color: #111827; font-size: 15px; font-weight: 900; overflow-wrap: anywhere; }
          .rx-pill { min-height: 28px; border-radius: 999px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 10px; color: #172033; font-size: 12px; font-weight: 800; text-align: center; overflow-wrap: anywhere; }
          .rx-details { margin-top: 11px; margin-left: 22px; display: grid; gap: 7px; border-left: 3px solid #bfdbfe; padding-left: 13px; }
          .rx-detail { display: grid; grid-template-columns: 94px minmax(0, 1fr); gap: 12px; font-size: 13px; line-height: 1.45; }
          .rx-label { color: #64748b; font-weight: 900; }
          .rx-value { color: #172033; font-weight: 700; white-space: pre-wrap; overflow-wrap: anywhere; }
          .note { min-height: 72px; white-space: pre-wrap; line-height: 1.55; font-size: 13px; }
          .footer { display: grid; grid-template-columns: 1fr 220px; gap: 18px; margin-top: 28px; align-items: end; }
          .sign { border-top: 1px solid #172033; padding-top: 8px; text-align: center; font-size: 12px; font-weight: 800; }
          @page { size: A4; margin: 0; }
          @media print {
            body { background: #ffffff; }
            .page { width: auto; min-height: auto; margin: 0; box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <header class="header">
            <div class="brand">
              <div class="logo">+</div>
              <div>
                <p class="caps muted">CityCare Hospital</p>
                <h1>OPD Prescription</h1>
                <p class="muted" style="margin-top:6px;font-size:13px;">Typed digital prescription for safe dispensing</p>
              </div>
            </div>
            <div class="doctor">
              <p><strong>${escapeHtml(appointment.doctor.name)}</strong></p>
              <p>${escapeHtml(appointment.doctor.specialty)}</p>
              <p>${escapeHtml(appointment.doctor.department)}</p>
              <p>Reg. No: CITYCARE-DEMO-1028</p>
            </div>
          </header>

          <section class="grid single">
            <div class="box">
              <h2>Patient Details</h2>
              <div class="patient-grid">
                ${printPatientField("Name", appointment.patient.name)}
                ${printPatientField("Age / Gender", `${appointment.patient.age} yrs / ${formatGender(appointment.patient.gender)}`)}
              </div>
            </div>
          </section>

          <section class="section">
            <div class="rx-sheet">
              <div class="rx-head">
                <span>Medicine</span>
                <span>Qty</span>
                <span>Duration</span>
              </div>
              ${
                medicines.length
                  ? medicines.map((item, index) => printMedicineBlock(item, index)).join("")
                  : '<div class="rx-empty">No medicine entered.</div>'
              }
            </div>
          </section>

          <section class="section">
            <h2>Follow-up</h2>
            <div class="box note">${escapeHtml(form.followUpNotes || "Not recorded")}</div>
          </section>

          <footer class="footer">
            <div class="muted" style="font-size:12px;line-height:1.55;">
              Use medicines exactly as prescribed. Seek urgent care for breathing difficulty, severe chest pain, fainting, facial swelling, or worsening symptoms.
            </div>
            <div class="sign">${escapeHtml(appointment.doctor.name)}<br/>Signature / Stamp</div>
          </footer>
        </main>
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function printLine(label: string, value: string) {
  return `<div class="line"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

function printPatientField(label: string, value: string) {
  return `<div class="patient-field"><span class="patient-label">${escapeHtml(label)}</span><span class="patient-value">${escapeHtml(value)}</span></div>`;
}

function printMedicineBlock(item: Prescription, index: number) {
  const doseWhen = [item.dosage, item.frequency].filter(Boolean).join(" - ") || "-";
  const instructions = [item.mealTiming ? `Food: ${item.mealTiming}` : "", item.instructions].filter(Boolean).join("\n") || "-";

  return `
    <div class="rx-item">
      <div class="rx-main">
        <div class="rx-medicine">${index + 1}. ${escapeHtml(item.medicine)}</div>
        <div class="rx-pill">${escapeHtml(item.quantity || "-")}</div>
        <div class="rx-pill">${escapeHtml(item.duration || "-")}</div>
      </div>
      <div class="rx-details">
        <div class="rx-detail">
          <span class="rx-label">Dose when</span>
          <span class="rx-value">${escapeHtml(doseWhen)}</span>
        </div>
        <div class="rx-detail">
          <span class="rx-label">Route</span>
          <span class="rx-value">${escapeHtml(item.route || "-")}</span>
        </div>
        <div class="rx-detail">
          <span class="rx-label">Instructions</span>
          <span class="rx-value">${escapeHtml(instructions)}</span>
        </div>
      </div>
    </div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDateKey(value: string) {
  return toDateKey(new Date(value));
}

function getTodayDateKey() {
  return toDateKey(new Date());
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parseDateKey(value));
}

function getCalendarDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      dateKey: toDateKey(date),
      inMonth: date.getMonth() === month,
      label: date.getDate(),
    };
  });
}

function getAppointmentDates(appointments: DoctorAppointment[]) {
  const uniqueDates = Array.from(new Set(appointments.map((appointment) => getDateKey(appointment.slot.startsAt))));

  return uniqueDates.map((value) => ({
    value,
    label: new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(new Date(`${value}T00:00:00.000Z`)),
  }));
}

function getCounts(appointments: DoctorAppointment[]) {
  return {
    waiting: appointments.filter((appointment) => appointment.status === "WAITING").length,
    active: appointments.filter((appointment) => appointment.status === "IN_PROGRESS").length,
    done: appointments.filter((appointment) => appointment.status === "COMPLETED").length,
  };
}

function sortAppointments(appointments: DoctorAppointment[]) {
  return [...appointments].sort(
    (first, second) => new Date(first.slot.startsAt).getTime() - new Date(second.slot.startsAt).getTime(),
  );
}

function groupAppointmentsByMainSlot(appointments: DoctorAppointment[], dateFilter: string) {
  const standardGroups = doctorSlotPeriods.map((period) => ({
    id: period.id,
    label: period.label,
    startsAt: createMainSlotStartsAt(dateFilter, period.startHour, period.startMinute),
    canAddPatient: true,
    appointments: sortAppointments(appointments).filter((appointment) =>
      isAppointmentInPeriod(appointment, period),
    ),
  }));

  const groupedAppointmentIds = new Set(
    standardGroups.flatMap((group) => group.appointments.map((appointment) => appointment.id)),
  );
  const outsideSessionFollowUps = sortAppointments(appointments).filter(
    (appointment) =>
      appointment.visitType === "FOLLOW_UP" &&
      !groupedAppointmentIds.has(appointment.id),
  );

  return outsideSessionFollowUps.length
    ? [
        ...standardGroups,
        {
          id: "follow-ups",
          label: "Follow-ups",
          startsAt: createMainSlotStartsAt(dateFilter, 0, 0),
          canAddPatient: false,
          appointments: outsideSessionFollowUps,
        },
      ]
    : standardGroups;
}

function isAppointmentInPeriod(
  appointment: DoctorAppointment,
  period: (typeof doctorSlotPeriods)[number],
) {
  const startsAt = new Date(appointment.slot.startsAt);
  const minuteOfDay = startsAt.getHours() * 60 + startsAt.getMinutes();
  const periodStart = period.startHour * 60 + period.startMinute;
  const periodEnd = period.endHour * 60 + period.endMinute;

  return minuteOfDay >= periodStart && minuteOfDay < periodEnd;
}

function createMainSlotStartsAt(dateKey: string, hour: number, minute: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const startsAt = new Date(year, month - 1, day);
  startsAt.setHours(hour, minute, 0, 0);
  return startsAt.toISOString();
}

function filterAppointments(appointments: DoctorAppointment[], dateFilter: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return sortAppointments(appointments).filter((appointment) => {
    const matchesDate = getDateKey(appointment.slot.startsAt) === dateFilter;
    const matchesQuery =
      !normalizedQuery ||
      appointment.patient.name.toLowerCase().includes(normalizedQuery) ||
      appointment.bookingCode.toLowerCase().includes(normalizedQuery) ||
      appointment.visitReason.toLowerCase().includes(normalizedQuery);

    return matchesDate && matchesQuery;
  });
}

function getPatientVisits(appointments: DoctorAppointment[], patientId: string) {
  return [...appointments]
    .filter((appointment) => appointment.patient.id === patientId)
    .sort((first, second) => new Date(second.slot.startsAt).getTime() - new Date(first.slot.startsAt).getTime());
}

function getElapsedSeconds(appointment: DoctorAppointment, now: number) {
  const record = appointment.clinicalRecord;
  if (!record?.startedAt) return record?.durationSeconds ?? 0;
  if (appointment.status === "COMPLETED") return record.durationSeconds ?? 0;
  return Math.max(record.durationSeconds ?? 0, Math.floor((now - new Date(record.startedAt).getTime()) / 1000));
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(value));
}

function formatGender(gender: Gender) {
  return gender.charAt(0) + gender.slice(1).toLowerCase();
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "Unknown size";
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAbnormalFlag(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return ["high", "low", "critical", "abnormal", "positive", "detected", "reactive"].some((flag) =>
    normalized.includes(flag),
  );
}
