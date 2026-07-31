import OpenAI from "openai";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CopilotAnalysisMode, VisitConversationStatus } from "@prisma/client";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CopilotMode = "loadAnalysis" | "consultAnalysis";

type CopilotPayload = {
  mode?: CopilotMode;
  appointment?: unknown;
  clinicalForm?: unknown;
};

type CopilotResponse = {
  summary: string;
  vitalsAnalysis: string[];
  historyAnalysis: string[];
  riskFlags: string[];
  suggestedQuestions: string[];
};

type VisitConversationTranscript = {
  bookingCode: string;
  language: string;
  plainTranscript: string;
  structuredTranscript: unknown;
  warnings: string[];
  modelName: string;
  completedAt: string;
};

const emptyResponse: CopilotResponse = {
  summary: "",
  vitalsAnalysis: [],
  historyAnalysis: [],
  riskFlags: [],
  suggestedQuestions: [],
};
const modelName = "nvidia/nemotron-3-super-120b-a12b";

export async function POST(request: Request) {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { message: "NVIDIA_API_KEY is not configured. Add it to .env and restart the dev server." },
      { status: 500 },
    );
  }

  const body = (await request.json()) as CopilotPayload;

  if (body.mode !== "loadAnalysis" && body.mode !== "consultAnalysis") {
    return NextResponse.json({ message: "Copilot mode is required." }, { status: 400 });
  }

  if (!body.appointment || !body.clinicalForm) {
    return NextResponse.json({ message: "Appointment and clinical form are required." }, { status: 400 });
  }

  const appointmentId = getAppointmentId(body.appointment);
  if (!appointmentId) {
    return NextResponse.json({ message: "Appointment id is required." }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      doctorId: true,
      patientId: true,
    },
  });

  if (!appointment) {
    return NextResponse.json({ message: "Appointment not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const sessionDoctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (sessionDoctorId !== appointment.doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });

  try {
    const extractedTestResults =
      body.mode === "loadAnalysis" ? await getExtractedTestResultsForLoadAnalysis(appointment.id) : [];
    const visitConversationTranscript = await getLatestVisitConversationTranscript(appointment.id);
    const clinicalSnapshot = {
      clinicalForm: body.clinicalForm,
      ...(visitConversationTranscript ? { visitConversationTranscript } : {}),
    };
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: [
            "You are a conservative clinical decision support assistant for a licensed doctor.",
            "Return only valid JSON. Do not include markdown.",
            "Do not provide final diagnosis certainty. Surface risks, missing data, and questions for doctor review.",
            "Do not recommend, suggest, list, or imply medicines, prescriptions, doses, routes, frequencies, durations, or quantities.",
            "The doctor will write the prescription manually. Focus only on clinical analysis, vitals, history, risks, and follow-up questions or tests.",
            "When a visitConversationTranscript is provided, use its Doctor/Patient turns as source evidence for the current visit. Do not treat transcript text as perfectly reliable; flag clinically important uncertainty or contradictions.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task:
              body.mode === "loadAnalysis"
                ? "Analyze patient history, vitals, visit reason, missing data, and risk signals. Do not include medicines or prescriptions."
                : "Analyze history, vitals, current observations, diagnosis, and follow-up notes. Return clinical analysis only. Do not include medicines or prescriptions.",
            requiredJsonShape: emptyResponse,
            mode: body.mode,
            appointment: body.appointment,
            clinicalForm: body.clinicalForm,
            ...(visitConversationTranscript ? { visitConversationTranscript } : {}),
            ...(extractedTestResults.length ? { extractedTestResults } : {}),
          }),
        },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    const parsed = parseCopilotJson(content);
    const normalized = normalizeCopilotResponse(parsed);
    const generatedAt = new Date();

    const saved = await prisma.patientAiAnalysis.upsert({
      where: { appointmentId: appointment.id },
      update: {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        mode: toAnalysisMode(body.mode),
        summary: normalized.summary,
        vitalsAnalysisJson: stringifyAnalysisArray(normalized.vitalsAnalysis),
        historyAnalysisJson: stringifyAnalysisArray(normalized.historyAnalysis),
        riskFlagsJson: stringifyAnalysisArray(normalized.riskFlags),
        suggestedQuestionsJson: stringifyAnalysisArray(normalized.suggestedQuestions),
        clinicalSnapshotJson: JSON.stringify(clinicalSnapshot),
        modelName,
        generatedAt,
      },
      create: {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        mode: toAnalysisMode(body.mode),
        summary: normalized.summary,
        vitalsAnalysisJson: stringifyAnalysisArray(normalized.vitalsAnalysis),
        historyAnalysisJson: stringifyAnalysisArray(normalized.historyAnalysis),
        riskFlagsJson: stringifyAnalysisArray(normalized.riskFlags),
        suggestedQuestionsJson: stringifyAnalysisArray(normalized.suggestedQuestions),
        clinicalSnapshotJson: JSON.stringify(clinicalSnapshot),
        modelName,
        generatedAt,
      },
    });

    return NextResponse.json({
      ...normalized,
      id: saved.id,
      generatedAt: saved.generatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Doctor copilot failed", error);
    return NextResponse.json({ message: "Could not generate clinical copilot analysis." }, { status: 500 });
  }
}

async function getLatestVisitConversationTranscript(appointmentId: string): Promise<VisitConversationTranscript | null> {
  const conversation = await prisma.visitConversation.findFirst({
    where: {
      appointmentId,
      status: VisitConversationStatus.COMPLETED,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      bookingCode: true,
      language: true,
      plainTranscript: true,
      speakerJson: true,
      modelName: true,
      updatedAt: true,
    },
  });

  if (!conversation?.speakerJson && !conversation?.plainTranscript) return null;

  const structuredTranscript = parseStoredJsonObject(conversation.speakerJson);
  const warnings =
    structuredTranscript &&
    typeof structuredTranscript === "object" &&
    "warnings" in structuredTranscript &&
    Array.isArray((structuredTranscript as { warnings?: unknown }).warnings)
      ? normalizeStringArray((structuredTranscript as { warnings?: unknown }).warnings)
      : [];

  return {
    bookingCode: conversation.bookingCode,
    language: conversation.language ?? "",
    plainTranscript: conversation.plainTranscript ?? "",
    structuredTranscript,
    warnings,
    modelName: conversation.modelName ?? "",
    completedAt: conversation.updatedAt.toISOString(),
  };
}

async function getExtractedTestResultsForLoadAnalysis(appointmentId: string) {
  const record = await prisma.clinicalRecord.findUnique({
    where: { appointmentId },
    select: {
      testResults: {
        where: {
          extractionStatus: "COMPLETED",
        },
        orderBy: [{ extractedAt: "desc" }, { createdAt: "desc" }],
        select: {
          testName: true,
          reportTitle: true,
          labName: true,
          specimen: true,
          collectedAtText: true,
          reportedAtText: true,
          overallImpression: true,
          rawText: true,
          observationsJson: true,
          panelsJson: true,
          extractionWarnings: true,
          extractedAt: true,
        },
      },
    },
  });

  return (record?.testResults ?? [])
    .map((testResult) => ({
      testName: testResult.testName,
      reportTitle: testResult.reportTitle ?? "",
      labName: testResult.labName ?? "",
      specimen: testResult.specimen ?? "",
      collectedAtText: testResult.collectedAtText ?? "",
      reportedAtText: testResult.reportedAtText ?? "",
      overallImpression: testResult.overallImpression ?? "",
      rawText: testResult.rawText ?? "",
      observations: parseStoredJsonArray(testResult.observationsJson),
      panels: parseStoredJsonArray(testResult.panelsJson),
      extractionWarnings: parseStoredStringArray(testResult.extractionWarnings),
      extractedAt: testResult.extractedAt?.toISOString() ?? "",
    }))
    .filter(
      (testResult) =>
        testResult.overallImpression ||
        testResult.rawText ||
        testResult.observations.length ||
        testResult.panels.length,
    );
}

function parseCopilotJson(content: string | null | undefined) {
  if (!content) return emptyResponse;

  try {
    return JSON.parse(content) as Partial<CopilotResponse>;
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return emptyResponse;
    return JSON.parse(jsonMatch[0]) as Partial<CopilotResponse>;
  }
}

function normalizeCopilotResponse(value: Partial<CopilotResponse>): CopilotResponse {
  return {
    summary: typeof value.summary === "string" ? value.summary : "",
    vitalsAnalysis: normalizeStringArray(value.vitalsAnalysis),
    historyAnalysis: normalizeStringArray(value.historyAnalysis),
    riskFlags: normalizeStringArray(value.riskFlags),
    suggestedQuestions: normalizeStringArray(value.suggestedQuestions),
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : [];
}

function getAppointmentId(appointment: unknown) {
  if (!appointment || typeof appointment !== "object" || !("id" in appointment)) return "";
  const id = (appointment as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function toAnalysisMode(mode: CopilotMode) {
  return mode === "consultAnalysis" ? CopilotAnalysisMode.CONSULT_ANALYSIS : CopilotAnalysisMode.LOAD_ANALYSIS;
}

function stringifyAnalysisArray(value: string[]) {
  return JSON.stringify(value.slice(0, 8));
}

function parseStoredJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStoredJsonObject(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStoredStringArray(value: string) {
  return parseStoredJsonArray(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
