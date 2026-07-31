import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { ClinicalNotesGenerationStatus, VisitConversationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type GeneratedClinicalNotes = {
  observations?: unknown;
  diagnosis?: unknown;
  followUpNotes?: unknown;
  historyEntries?: unknown;
};

type GeneratedHistoryEntry = {
  title: string;
  detail: string;
};

export async function generateClinicalNotesForConversation(conversationId: string) {
  const conversation = await prisma.visitConversation.findUnique({
    where: { id: conversationId },
    include: {
      appointment: {
        include: {
          doctor: true,
          patient: {
            include: {
              medicalHistory: {
                orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
              },
            },
          },
          clinicalRecord: {
            include: { vitals: true },
          },
        },
      },
    },
  });

  if (!conversation || conversation.status !== VisitConversationStatus.COMPLETED) {
    return { status: "not-ready" as const };
  }

  const record = conversation.appointment.clinicalRecord;
  if (!record) {
    return { status: "missing-record" as const };
  }

  if (record.clinicalNotesGenerationStatus === ClinicalNotesGenerationStatus.COMPLETED) {
    return { status: "completed" as const };
  }

  if (record.clinicalNotesGenerationStatus === ClinicalNotesGenerationStatus.PROCESSING) {
    const processingIsStale = Date.now() - record.updatedAt.getTime() > 2 * 60_000;
    if (!processingIsStale) {
      return { status: "processing" as const };
    }

    await prisma.clinicalRecord.updateMany({
      where: {
        id: record.id,
        clinicalNotesGenerationStatus: ClinicalNotesGenerationStatus.PROCESSING,
      },
      data: {
        clinicalNotesGenerationStatus: ClinicalNotesGenerationStatus.PENDING,
        clinicalNotesGenerationError: "The previous generation attempt was interrupted and has been restarted.",
      },
    });
  }

  const claimed = await prisma.clinicalRecord.updateMany({
    where: {
      id: record.id,
      clinicalNotesGenerationStatus: {
        in: [
          ClinicalNotesGenerationStatus.IDLE,
          ClinicalNotesGenerationStatus.PENDING,
          ClinicalNotesGenerationStatus.FAILED,
        ],
      },
    },
    data: {
      clinicalNotesGenerationStatus: ClinicalNotesGenerationStatus.PROCESSING,
      clinicalNotesGenerationError: null,
    },
  });

  if (!claimed.count) {
    return { status: "processing" as const };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await markGenerationFailed(record.id, "OPENAI_API_KEY is not configured.");
    return { status: "failed" as const };
  }

  const modelName = process.env.OPENAI_CLINICAL_NOTES_MODEL || "gpt-4.1-mini";

  try {
    const openai = new OpenAI({
      apiKey,
      baseURL: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    });
    const structuredTranscript = parseJsonObject(conversation.speakerJson);
    const completedAt = conversation.completedAt ?? conversation.updatedAt;
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: [
            "You create conservative clinical documentation for a licensed doctor from a completed visit transcript.",
            "Return only valid JSON matching the requested shape, without markdown.",
            "Each clinical-note field must contain only useful ADDITIONAL text that is not already present in the corresponding existingDoctorText field.",
            "Use only facts stated in the transcript or supplied clinical context. Never invent examination findings, diagnoses, dates, red flags, reports, or instructions.",
            "Preserve uncertainty. A diagnosis must be described as working or differential unless the doctor explicitly confirmed it.",
            "Follow-up timing, warning signs, and reports must be included only when explicitly supported.",
            "Do not generate medicines, prescriptions, doses, routes, frequencies, quantities, or treatment advice.",
            "If a section has no supported additional information, return an empty string.",
            "History entries are limited to durable facts such as allergies, ongoing conditions, procedures, relevant current medications, family history, or lifestyle factors.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Extract additive clinical notes and durable history from this completed doctor-patient conversation.",
            requiredJsonShape: {
              observations: "Examination findings, patient state, and red flags, or an empty string",
              diagnosis: "Working diagnosis or differential with uncertainty, or an empty string",
              followUpNotes: "Explicit review timing, warning signs, and reports to bring, or an empty string",
              historyEntries: [
                {
                  title: "Short durable-history title",
                  detail: "Concise factual detail without treatment advice",
                },
              ],
            },
            visitDate: completedAt.toISOString().slice(0, 10),
            patient: {
              age: conversation.appointment.patient.age,
              gender: conversation.appointment.patient.gender,
              existingHistory: conversation.appointment.patient.medicalHistory.map((entry) => ({
                title: entry.title,
                detail: entry.detail,
              })),
            },
            visit: {
              reason: conversation.appointment.visitReason,
              doctorSpecialty: conversation.appointment.doctor.specialty,
              vitals: record.vitals,
            },
            existingDoctorText: {
              observations: record.observations ?? "",
              diagnosis: record.diagnosis ?? "",
              followUpNotes: record.followUpNotes ?? "",
            },
            transcript: structuredTranscript ?? conversation.plainTranscript ?? conversation.rawTranscript ?? "",
          }),
        },
      ],
      temperature: 0.1,
      top_p: 0.9,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const parsed = parseGeneratedJson(completion.choices[0]?.message?.content);
    const observationsAiDraft = normalizeNote(parsed.observations);
    const diagnosisAiDraft = normalizeNote(parsed.diagnosis);
    const followUpNotesAiDraft = normalizeNote(parsed.followUpNotes);
    const historyEntries = normalizeHistoryEntries(
      parsed.historyEntries,
      conversation.appointment.patient.medicalHistory,
    );
    const generatedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.clinicalRecord.update({
        where: { id: record.id },
        data: {
          observationsAiDraft,
          diagnosisAiDraft,
          followUpNotesAiDraft,
          clinicalNotesGenerationStatus: ClinicalNotesGenerationStatus.COMPLETED,
          clinicalNotesGenerationError: null,
          clinicalNotesModelName: modelName,
          clinicalNotesGeneratedAt: generatedAt,
          clinicalNotesDraftVersion: randomUUID(),
        },
      });

      if (historyEntries.length) {
        await tx.patientMedicalHistory.createMany({
          data: historyEntries.map((entry) => ({
            patientId: conversation.appointment.patientId,
            title: entry.title,
            detail: entry.detail,
            recordedAt: generatedAt,
          })),
        });
      }
    });

    return { status: "completed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Clinical-note generation failed.";
    console.error("Clinical-note generation failed", error);
    await markGenerationFailed(record.id, message);
    return { status: "failed" as const };
  }
}

async function markGenerationFailed(recordId: string, message: string) {
  await prisma.clinicalRecord.update({
    where: { id: recordId },
    data: {
      clinicalNotesGenerationStatus: ClinicalNotesGenerationStatus.FAILED,
      clinicalNotesGenerationError: message,
    },
  });
}

function parseGeneratedJson(content: string | null | undefined): GeneratedClinicalNotes {
  if (!content) return {};

  try {
    return JSON.parse(content) as GeneratedClinicalNotes;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as GeneratedClinicalNotes) : {};
  }
}

function parseJsonObject(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeNote(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, 6000);
  return normalized || null;
}

function normalizeHistoryEntries(
  value: unknown,
  existing: { title: string; detail: string }[],
): GeneratedHistoryEntry[] {
  if (!Array.isArray(value)) return [];

  const existingKeys = new Set(existing.map((entry) => historyKey(entry.title, entry.detail)));
  const nextKeys = new Set<string>();

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as { title?: unknown; detail?: unknown };
      const title = typeof candidate.title === "string" ? candidate.title.trim().replace(/\s+/g, " ").slice(0, 90) : "";
      const detail = typeof candidate.detail === "string" ? candidate.detail.trim().replace(/\s+/g, " ").slice(0, 500) : "";
      return title && detail ? { title, detail } : null;
    })
    .filter((entry): entry is GeneratedHistoryEntry => {
      if (!entry) return false;
      const key = historyKey(entry.title, entry.detail);
      if (existingKeys.has(key) || nextKeys.has(key)) return false;
      nextKeys.add(key);
      return true;
    })
    .slice(0, 5);
}

function historyKey(title: string, detail: string) {
  return `${title.trim().toLowerCase()}|${detail.trim().toLowerCase()}`;
}
