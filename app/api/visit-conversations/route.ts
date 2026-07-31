import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { TranscriptionStatus, VisitConversationStatus } from "@prisma/client";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { generateClinicalNotesForConversation } from "@/lib/clinical-note-generation";
import { visitConversationRecordingEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import {
  downloadStorageObject,
  removeStorageObjects,
  storageObjectPath,
  uploadStorageObject,
} from "@/lib/supabase-storage";

export const runtime = "nodejs";

type SpeakerTurn = {
  speaker?: string;
  text?: string;
  sourceChunkIndexes?: number[];
  confidence?: number | null;
};

type SpeakerTranscript = {
  bookingCode?: string;
  language?: string;
  turns?: SpeakerTurn[];
  plainTranscript?: string;
  warnings?: string[];
};

const maxDurationSeconds = 4 * 60 * 60;
const maxRecordingBytes = 250 * 1024 * 1024;
const maxChunkBytes = 32 * 1024 * 1024;
const maxChunks = 240;
const elevenLabsModelName = "elevenlabs/scribe_v2";
const elevenLabsSpeechToTextUrl = "https://api.elevenlabs.io/v1/speech-to-text";

type ScribeWord = {
  text?: string;
  type?: string;
  start?: number;
  end?: number;
  speaker_id?: string;
  speaker?: string;
  role?: string;
  logprob?: number;
};

type ScribeResponse = {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: ScribeWord[];
};

type NormalizedScribeWord = {
  text: string;
  type: string;
  start: number | null;
  end: number | null;
  speakerId: string;
  confidence: number | null;
};

type NormalizedSpeakerTurn = {
  speaker: "Doctor" | "Patient";
  text: string;
  sourceChunkIndexes: number[];
  confidence: number | null;
};

export async function GET(request: Request) {
  if (!visitConversationRecordingEnabled) {
    return NextResponse.json({ message: "Visit conversation recording is disabled." }, { status: 404 });
  }

  const url = new URL(request.url);
  const doctorId = url.searchParams.get("doctorId") ?? "";
  const appointmentId = url.searchParams.get("appointmentId") ?? "";

  if (!doctorId || !appointmentId) {
    return NextResponse.json({ message: "Doctor and appointment are required." }, { status: 400 });
  }

  const authError = await validateDoctorSession(doctorId);
  if (authError) return authError;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      doctorId: true,
      clinicalRecord: {
        select: {
          observations: true,
          diagnosis: true,
          followUpNotes: true,
          observationsAiDraft: true,
          diagnosisAiDraft: true,
          followUpNotesAiDraft: true,
          clinicalNotesGenerationStatus: true,
          clinicalNotesGenerationError: true,
          clinicalNotesGeneratedAt: true,
          clinicalNotesDraftVersion: true,
        },
      },
    },
  });

  if (!appointment || appointment.doctorId !== doctorId) {
    return NextResponse.json({ message: "Appointment is not available for this doctor." }, { status: 403 });
  }

  const conversation = await prisma.visitConversation.findFirst({
    where: { appointmentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  return NextResponse.json({
    conversation: conversation ? serializeConversation(conversation) : null,
    clinicalNotes: serializeClinicalNotes(appointment.clinicalRecord),
  });
}

export async function POST(request: Request) {
  if (!visitConversationRecordingEnabled) {
    return NextResponse.json({ message: "Visit conversation recording is disabled." }, { status: 404 });
  }

  const formData = await request.formData();
  const doctorId = String(formData.get("doctorId") ?? "");
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const bookingCode = String(formData.get("bookingCode") ?? "").trim().toUpperCase();
  const durationSeconds = Math.ceil(Number(formData.get("durationSeconds") ?? 0));
  const startedAtText = String(formData.get("startedAt") ?? "");
  const completedAtText = String(formData.get("completedAt") ?? "");
  const recording = formData.get("recording");
  const chunks = formData.getAll("chunks").filter((item): item is File => item instanceof File);

  if (!doctorId || !appointmentId || !bookingCode || !(recording instanceof File) || !chunks.length) {
    return NextResponse.json({ message: "Doctor, appointment, booking, recording, and chunks are required." }, { status: 400 });
  }

  const authError = await validateDoctorSession(doctorId);
  if (authError) return authError;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDurationSeconds) {
    return NextResponse.json({ message: "Visit recording duration is invalid." }, { status: 400 });
  }

  if (recording.size <= 0 || recording.size > maxRecordingBytes || !isAllowedAudio(recording)) {
    return NextResponse.json({ message: "Visit recording must be a supported audio file up to 250 MB." }, { status: 400 });
  }

  if (chunks.length > maxChunks) {
    return NextResponse.json({ message: `Upload ${maxChunks} one-minute chunks or fewer.` }, { status: 400 });
  }

  const invalidChunk = chunks.find((chunk) => chunk.size <= 0 || chunk.size > maxChunkBytes || !isAllowedAudio(chunk));
  if (invalidChunk) {
    return NextResponse.json({ message: "Each conversation chunk must be a supported audio file up to 32 MB." }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, bookingCode: true },
  });

  if (!appointment || appointment.doctorId !== doctorId || appointment.bookingCode !== bookingCode) {
    return NextResponse.json({ message: "Recording does not match this doctor visit." }, { status: 403 });
  }

  const startedAt = parseDate(startedAtText);
  const completedAt = parseDate(completedAtText);
  const safeBookingCode = sanitizePathSegment(appointment.bookingCode);
  const attemptLabel = `attempt-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
  const folderPath = storageObjectPath("visit-conversations", safeBookingCode, attemptLabel);
  const recordingExtension = extensionForAudio(recording);
  const recordingPath = storageObjectPath(folderPath, `recording.${recordingExtension}`);

  const recordingBuffer = Buffer.from(await recording.arrayBuffer());

  const chunkPayloads = await Promise.all(
    chunks.map(async (chunk, index) => {
      const chunkIndex = index + 1;
      const extension = extensionForAudio(chunk);
      const fileName = `chunk-${String(chunkIndex).padStart(3, "0")}.${extension}`;
      const objectPath = storageObjectPath(folderPath, "chunks", fileName);
      const buffer = Buffer.from(await chunk.arrayBuffer());

      return {
        chunkIndex,
        objectPath,
        buffer,
        mimeType: chunk.type || recording.type || "application/octet-stream",
        sizeBytes: buffer.byteLength,
      };
    }),
  );

  const uploadedPaths: string[] = [];
  let conversation;

  try {
    await uploadStorageObject({
      objectPath: recordingPath,
      body: recordingBuffer,
      contentType: recording.type || "application/octet-stream",
    });
    uploadedPaths.push(recordingPath);

    for (const chunk of chunkPayloads) {
      await uploadStorageObject({
        objectPath: chunk.objectPath,
        body: chunk.buffer,
        contentType: chunk.mimeType,
      });
      uploadedPaths.push(chunk.objectPath);
    }

    conversation = await prisma.visitConversation.create({
      data: {
        appointmentId: appointment.id,
        bookingCode: appointment.bookingCode,
        attemptLabel,
        folderPath,
        recordingPath,
        mimeType: recording.type || "application/octet-stream",
        sizeBytes: recordingBuffer.byteLength,
        durationSeconds,
        status: VisitConversationStatus.UPLOADED,
        startedAt,
        completedAt,
        chunks: {
          create: chunkPayloads.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            filePath: chunk.objectPath,
            mimeType: chunk.mimeType,
            sizeBytes: chunk.sizeBytes,
            durationSeconds: Math.min(60, Math.max(1, durationSeconds - (chunk.chunkIndex - 1) * 60)),
          })),
        },
      },
    });
  } catch (error) {
    await removeStorageObjects(uploadedPaths).catch((cleanupError) => {
      console.error("Failed to clean up conversation uploads", cleanupError);
    });
    throw error;
  }

  await prisma.clinicalRecord.updateMany({
    where: { appointmentId: appointment.id },
    data: {
      clinicalNotesGenerationStatus: "PENDING",
      clinicalNotesGenerationError: null,
    },
  });

  void processConversation(conversation.id).catch((error) => {
    console.error("Visit conversation processing failed", error);
  });

  return NextResponse.json({
    message: "Visit conversation uploaded.",
    conversationId: conversation.id,
    status: conversation.status,
  });
}

export async function PUT(request: Request) {
  if (!visitConversationRecordingEnabled) {
    return NextResponse.json({ message: "Visit conversation recording is disabled." }, { status: 404 });
  }

  const body = (await request.json()) as { doctorId?: string; appointmentId?: string };
  const doctorId = body.doctorId ?? "";
  const appointmentId = body.appointmentId ?? "";

  if (!doctorId || !appointmentId) {
    return NextResponse.json({ message: "Doctor and appointment are required." }, { status: 400 });
  }

  const authError = await validateDoctorSession(doctorId);
  if (authError) return authError;

  const conversation = await prisma.visitConversation.findFirst({
    where: {
      appointmentId,
      appointment: { doctorId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true },
  });

  if (!conversation) {
    return NextResponse.json({ message: "No conversation recording is available." }, { status: 404 });
  }

  if (conversation.status !== VisitConversationStatus.FAILED) {
    return NextResponse.json({ message: "Only a failed transcription can be retried." }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.visitConversation.update({
      where: { id: conversation.id },
      data: {
        status: VisitConversationStatus.UPLOADED,
        errorMessage: null,
      },
    }),
    prisma.visitConversationChunk.updateMany({
      where: { conversationId: conversation.id },
      data: {
        status: TranscriptionStatus.PENDING,
        errorMessage: null,
      },
    }),
    prisma.clinicalRecord.updateMany({
      where: { appointmentId },
      data: {
        clinicalNotesGenerationStatus: "PENDING",
        clinicalNotesGenerationError: null,
      },
    }),
  ]);

  void processConversation(conversation.id).catch((error) => {
    console.error("Visit conversation retry failed", error);
  });

  return NextResponse.json({ message: "Transcription retry started." });
}

async function processConversation(conversationId: string) {
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;

  if (!elevenLabsApiKey) {
    await markConversationFailed(conversationId, "ELEVENLABS_API_KEY is not configured.");
    return;
  }

  const conversation = await prisma.visitConversation.findUnique({
    where: { id: conversationId },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  if (!conversation) return;

  await prisma.visitConversation.update({
    where: { id: conversation.id },
    data: {
      status: VisitConversationStatus.TRANSCRIBING,
      errorMessage: null,
    },
  });

  try {
    const audio = await downloadStorageObject(conversation.recordingPath);
    const scribeResponse = await transcribeConversationWithScribe({
      apiKey: elevenLabsApiKey,
      audio,
      mimeType: conversation.mimeType,
      fileName: conversation.recordingPath.split("/").at(-1) || "conversation.webm",
    });

    const scribeJsonPath = storageObjectPath(conversation.folderPath, "transcripts", "elevenlabs-scribe-v2.json");
    await uploadStorageObject({
      objectPath: scribeJsonPath,
      body: JSON.stringify(scribeResponse, null, 2),
      contentType: "application/json",
      upsert: true,
    });

    const rawTranscript = typeof scribeResponse.text === "string" ? scribeResponse.text.trim() : "";
    const words = normalizeScribeWords(scribeResponse.words);

    if (!rawTranscript && !words.length) {
      await markConversationChunksFailed(conversation.id, "No speech was detected in the visit conversation.");
      await markConversationFailed(conversation.id, "No speech was detected in the visit conversation.");
      return;
    }

    for (const chunk of conversation.chunks) {
      const text = buildChunkTranscript(words, chunk.chunkIndex, Number(chunk.durationSeconds) || 60);
      const transcriptPath = storageObjectPath(
        conversation.folderPath,
        "transcripts",
        `chunk-${String(chunk.chunkIndex).padStart(3, "0")}.json`,
      );
      await uploadStorageObject({
        objectPath: transcriptPath,
        body: JSON.stringify(
          {
            chunkIndex: chunk.chunkIndex,
            text,
            source: "elevenlabs/scribe_v2",
            transcribedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        contentType: "application/json",
        upsert: true,
      });

      await prisma.visitConversationChunk.update({
        where: { id: chunk.id },
        data: {
          transcriptPath,
          transcript: text,
          status: TranscriptionStatus.COMPLETED,
          errorMessage: null,
          transcribedAt: new Date(),
        },
      });
    }

    await prisma.visitConversation.update({
      where: { id: conversation.id },
      data: {
        status: VisitConversationStatus.LABELING,
        rawTranscript: rawTranscript || words.map((word) => word.text).join(" ").trim(),
      },
    });

    const speakerTranscript = buildSpeakerTranscriptFromScribe(scribeResponse, conversation.bookingCode);
    const speakerJson = JSON.stringify(speakerTranscript, null, 2);
    const conversationJsonPath = storageObjectPath(conversation.folderPath, "conversation.json");

    await uploadStorageObject({
      objectPath: conversationJsonPath,
      body: speakerJson,
      contentType: "application/json",
      upsert: true,
    });

    await prisma.visitConversation.update({
      where: { id: conversation.id },
      data: {
        status: VisitConversationStatus.COMPLETED,
        errorMessage: null,
        speakerJson,
        plainTranscript: speakerTranscript.plainTranscript,
        language: speakerTranscript.language,
        modelName: elevenLabsModelName,
      },
    });

    await generateClinicalNotesForConversation(conversation.id);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "ElevenLabs transcription failed.";
    await markConversationChunksFailed(conversation.id, message);
    await markConversationFailed(
      conversation.id,
      message,
    );
    await prisma.clinicalRecord.updateMany({
      where: { appointmentId: conversation.appointmentId },
      data: {
        clinicalNotesGenerationStatus: "FAILED",
        clinicalNotesGenerationError: `Transcript failed: ${message}`.slice(0, 500),
      },
    });
  }
}

async function transcribeConversationWithScribe({
  apiKey,
  audio,
  mimeType,
  fileName,
}: {
  apiKey: string;
  audio: Buffer;
  mimeType: string;
  fileName: string;
}) {
  const model = process.env.ELEVENLABS_TRANSCRIPTION_MODEL || "scribe_v2";
  const language = process.env.ELEVENLABS_TRANSCRIPTION_LANGUAGE || "";
  const body = new FormData();
  const audioArrayBuffer = new ArrayBuffer(audio.byteLength);
  new Uint8Array(audioArrayBuffer).set(audio);

  body.set("file", new Blob([audioArrayBuffer], { type: mimeType || "audio/webm" }), fileName);
  body.set("model_id", model);
  body.set("diarize", "true");
  body.set("num_speakers", "2");
  body.set("timestamps_granularity", "word");
  body.set("detect_speaker_roles", "true");
  if (language.trim()) {
    body.set("language_code", language.trim());
  }

  const response = await fetch(elevenLabsSpeechToTextUrl, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload?.detail?.message ?? payload?.detail ?? payload?.message ?? "ElevenLabs transcription failed.";
    throw new Error(String(message).slice(0, 500));
  }

  return payload as ScribeResponse;
}

function normalizeScribeWords(value: unknown): NormalizedScribeWord[] {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const word = item as ScribeWord;
          const text = typeof word.text === "string" ? word.text.trim() : "";
          if (!text) return null;

          return {
            text,
            type: typeof word.type === "string" ? word.type : "word",
            start: Number.isFinite(word.start) ? Number(word.start) : null,
            end: Number.isFinite(word.end) ? Number(word.end) : null,
            speakerId: normalizeSpeakerId(word.speaker_id ?? word.speaker ?? word.role),
            confidence: Number.isFinite(word.logprob) ? logprobToConfidence(Number(word.logprob)) : null,
          };
        })
        .filter(
          (
            word,
          ): word is {
            text: string;
            type: string;
            start: number | null;
            end: number | null;
            speakerId: string;
            confidence: number | null;
          } => Boolean(word),
        )
    : [];
}

function buildChunkTranscript(words: NormalizedScribeWord[], chunkIndex: number, durationSeconds: number) {
  if (!words.length) return "";

  const chunkStart = (chunkIndex - 1) * 60;
  const chunkEnd = chunkStart + durationSeconds;
  const chunkWords = words.filter((word) => {
    const start = word.start ?? word.end ?? 0;
    const end = word.end ?? word.start ?? start;
    return start < chunkEnd && end > chunkStart;
  });

  return joinTranscriptWords(chunkWords);
}

function buildSpeakerTranscriptFromScribe(response: ScribeResponse, bookingCode: string): SpeakerTranscript {
  const words = normalizeScribeWords(response.words);
  const language = typeof response.language_code === "string" && response.language_code.trim() ? response.language_code.trim() : "detected or mixed";
  const warnings: string[] = [];

  if (!words.length) {
    const text = typeof response.text === "string" ? response.text.trim() : "";
    if (!text) throw new Error("No speech was detected in the visit conversation.");

    warnings.push("Scribe response did not include word-level speaker timestamps; transcript was assigned to Doctor.");
    return {
      bookingCode,
      language,
      turns: [{ speaker: "Doctor", text, sourceChunkIndexes: [], confidence: null }],
      plainTranscript: `Doctor: ${text}`,
      warnings,
    };
  }

  const speakerMap = buildSpeakerMap(words, warnings);
  const turns: NormalizedSpeakerTurn[] = [];

  for (const word of words) {
    if (word.type !== "word") continue;
    const speaker = speakerMap.get(word.speakerId) ?? "Patient";
    const chunkIndex = word.start === null ? null : Math.max(1, Math.floor(word.start / 60) + 1);
    const previous = turns.at(-1);

    if (previous && previous.speaker === speaker) {
      previous.text = joinTranscriptWords([{ text: previous.text }, word]);
      if (chunkIndex && !previous.sourceChunkIndexes.includes(chunkIndex)) {
        previous.sourceChunkIndexes.push(chunkIndex);
      }
      previous.confidence = averageConfidence(previous.confidence ?? null, word.confidence);
    } else {
      turns.push({
        speaker,
        text: word.text,
        sourceChunkIndexes: chunkIndex ? [chunkIndex] : [],
        confidence: word.confidence,
      });
    }
  }

  if (!turns.length) {
    const text = typeof response.text === "string" ? response.text.trim() : "";
    if (!text) throw new Error("No speech was detected in the visit conversation.");
    warnings.push("Scribe response contained no spoken word entries; transcript was assigned to Doctor.");
    turns.push({ speaker: "Doctor", text, sourceChunkIndexes: [], confidence: null });
  }

  return {
    bookingCode,
    language,
    turns,
    plainTranscript: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n"),
    warnings: warnings.slice(0, 12),
  };
}

function buildSpeakerMap(words: NormalizedScribeWord[], warnings: string[]) {
  const speakerMap = new Map<string, "Doctor" | "Patient">();
  const speakerIds = uniqueSpeakerIdsByFirstTimestamp(words);
  const hasAgent = speakerIds.includes("agent");
  const hasCustomer = speakerIds.includes("customer");

  if (hasAgent) speakerMap.set("agent", "Doctor");
  if (hasCustomer) speakerMap.set("customer", "Patient");

  const fallbackIds = speakerIds.filter((id) => id !== "agent" && id !== "customer" && id !== "unknown");

  if (hasAgent || hasCustomer) {
    if (fallbackIds.length) {
      warnings.push(`Unexpected Scribe speaker ids were mapped into Doctor/Patient labels: ${fallbackIds.join(", ")}.`);
    }
    for (const id of fallbackIds) {
      if (![...speakerMap.values()].includes("Doctor")) {
        speakerMap.set(id, "Doctor");
      } else {
        speakerMap.set(id, "Patient");
      }
    }
  } else {
    if (fallbackIds[0]) speakerMap.set(fallbackIds[0], "Doctor");
    if (fallbackIds[1]) speakerMap.set(fallbackIds[1], "Patient");
    if (fallbackIds.length > 2) {
      warnings.push(`Unexpected Scribe speaker ids were mapped into Doctor/Patient labels: ${fallbackIds.slice(2).join(", ")}.`);
      for (const id of fallbackIds.slice(2)) {
        speakerMap.set(id, "Patient");
      }
    }
  }

  if (!speakerMap.size) {
    warnings.push("Scribe response did not identify speakers; transcript was assigned to Doctor.");
  }
  speakerMap.set("unknown", speakerMap.size ? "Patient" : "Doctor");

  return speakerMap;
}

function uniqueSpeakerIdsByFirstTimestamp(words: NormalizedScribeWord[]) {
  const firstSeen = new Map<string, number>();

  for (const word of words) {
    const speakerId = word.speakerId;
    const start = word.start ?? Number.MAX_SAFE_INTEGER;
    firstSeen.set(speakerId, Math.min(firstSeen.get(speakerId) ?? Number.MAX_SAFE_INTEGER, start));
  }

  return [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([speakerId]) => speakerId);
}

function normalizeSpeakerId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "unknown";
}

function joinTranscriptWords(words: { text: string }[]) {
  return words
    .map((word) => word.text)
    .join(" ")
    .replace(/\s+([.,!?;:%])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function logprobToConfidence(logprob: number) {
  return Math.max(0, Math.min(1, Math.exp(logprob)));
}

function averageConfidence(current: number | null, next: number | null) {
  if (current === null) return next;
  if (next === null) return current;
  return Math.max(0, Math.min(1, (current + next) / 2));
}

async function markConversationFailed(conversationId: string, errorMessage: string) {
  await prisma.visitConversation.update({
    where: { id: conversationId },
    data: {
      status: VisitConversationStatus.FAILED,
      errorMessage,
    },
  });
}

async function markConversationChunksFailed(conversationId: string, errorMessage: string) {
  await prisma.visitConversationChunk.updateMany({
    where: { conversationId },
    data: {
      status: TranscriptionStatus.FAILED,
      errorMessage,
      transcribedAt: new Date(),
    },
  });
}

async function validateDoctorSession(doctorId: string) {
  const cookieStore = await cookies();
  const sessionDoctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (sessionDoctorId !== doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  return null;
}

function serializeConversation(
  conversation: Awaited<ReturnType<typeof prisma.visitConversation.findFirst>> & {
    chunks?: {
      id: string;
      chunkIndex: number;
      status: TranscriptionStatus;
      transcript: string | null;
      errorMessage: string | null;
    }[];
  },
) {
  const speaker = parseSpeakerJson(conversation?.speakerJson);

  return {
    id: conversation?.id,
    bookingCode: conversation?.bookingCode,
    attemptLabel: conversation?.attemptLabel,
    status: conversation?.status,
    errorMessage: conversation?.errorMessage ?? "",
    durationSeconds: conversation?.durationSeconds ?? 0,
    language: conversation?.language ?? speaker?.language ?? "",
    plainTranscript: conversation?.plainTranscript ?? speaker?.plainTranscript ?? "",
    audioUrl: conversation?.id ? `/api/visit-conversations/${conversation.id}/audio` : "",
    turns: speaker?.turns ?? [],
    warnings: speaker?.warnings ?? [],
    chunks:
      conversation?.chunks?.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        status: chunk.status,
        transcript: chunk.transcript ?? "",
        errorMessage: chunk.errorMessage ?? "",
      })) ?? [],
    createdAt: conversation?.createdAt.toISOString(),
    updatedAt: conversation?.updatedAt.toISOString(),
  };
}

function serializeClinicalNotes(
  record:
    | {
        observations: string | null;
        diagnosis: string | null;
        followUpNotes: string | null;
        observationsAiDraft: string | null;
        diagnosisAiDraft: string | null;
        followUpNotesAiDraft: string | null;
        clinicalNotesGenerationStatus: string;
        clinicalNotesGenerationError: string | null;
        clinicalNotesGeneratedAt: Date | null;
        clinicalNotesDraftVersion: string | null;
      }
    | null,
) {
  if (!record) return null;

  return {
    observations: combineClinicalNote(record.observations, record.observationsAiDraft),
    diagnosis: combineClinicalNote(record.diagnosis, record.diagnosisAiDraft),
    followUpNotes: combineClinicalNote(record.followUpNotes, record.followUpNotesAiDraft),
    unverified: {
      observations: Boolean(record.observationsAiDraft),
      diagnosis: Boolean(record.diagnosisAiDraft),
      followUpNotes: Boolean(record.followUpNotesAiDraft),
    },
    generationStatus: record.clinicalNotesGenerationStatus,
    generationError: record.clinicalNotesGenerationError ?? "",
    generatedAt: record.clinicalNotesGeneratedAt?.toISOString() ?? null,
    draftVersion: record.clinicalNotesDraftVersion ?? "",
  };
}

function combineClinicalNote(verified: string | null, aiDraft: string | null) {
  return [verified?.trim(), aiDraft?.trim()].filter(Boolean).join("\n\n");
}

function parseSpeakerJson(value: string | null | undefined): SpeakerTranscript | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as SpeakerTranscript;
  } catch {
    return null;
  }
}

function parseDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^A-Z0-9-]/g, "");
}

function isAllowedAudio(file: File) {
  return (
    [
      "audio/webm",
      "audio/wav",
      "audio/wave",
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/ogg",
      "audio/x-m4a",
    ].includes(file.type) || /\.(m4a|mp3|mp4|ogg|opus|wav|webm)$/i.test(file.name)
  );
}

function extensionForAudio(file: File) {
  if (file.type.includes("wav") || file.name.toLowerCase().endsWith(".wav")) return "wav";
  if (file.type.includes("mpeg") || file.type.includes("mp3") || file.name.toLowerCase().endsWith(".mp3")) return "mp3";
  if (file.type.includes("ogg") || file.name.toLowerCase().endsWith(".ogg")) return "ogg";
  if (file.type.includes("mp4") || file.type.includes("m4a") || /\.(m4a|mp4)$/i.test(file.name)) return "m4a";
  return "webm";
}
