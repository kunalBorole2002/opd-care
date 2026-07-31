import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { TranscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { removeStorageObjects, storageObjectPath, uploadStorageObject } from "@/lib/supabase-storage";

export const runtime = "nodejs";

const maxDurationSeconds = 30;
const maxFileBytes = 4 * 1024 * 1024;
export async function POST(request: Request) {
  const formData = await request.formData();
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const bookingCode = String(formData.get("bookingCode") ?? "").trim().toUpperCase();
  const durationSeconds = Math.ceil(Number(formData.get("durationSeconds") ?? 0));
  const file = formData.get("file");

  if (!appointmentId || !bookingCode || !(file instanceof File)) {
    return NextResponse.json({ message: "Recording, appointment, and booking code are required." }, { status: 400 });
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDurationSeconds) {
    return NextResponse.json({ message: "Recording must be 30 seconds or less." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > maxFileBytes) {
    return NextResponse.json({ message: "Recording file is too large." }, { status: 400 });
  }

  if (!isWavFile(file)) {
    return NextResponse.json({ message: "Recording must be a WAV audio file." }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      bookingCode: true,
      recording: { select: { filePath: true } },
    },
  });

  if (!appointment || appointment.bookingCode !== bookingCode) {
    return NextResponse.json({ message: "Recording does not match this visit reference." }, { status: 403 });
  }

  const fileName = `${appointment.bookingCode}-${randomUUID()}.wav`;
  const objectPath = storageObjectPath("visit-reason-recordings", appointment.bookingCode, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (!hasWavHeader(buffer)) {
    return NextResponse.json({ message: "Recording file is not a valid WAV file." }, { status: 400 });
  }

  await uploadStorageObject({ objectPath, body: buffer, contentType: "audio/wav" });

  let recording;
  try {
    recording = await prisma.visitReasonRecording.upsert({
      where: { appointmentId: appointment.id },
      update: {
        bookingCode: appointment.bookingCode,
        filePath: objectPath,
        mimeType: "audio/wav",
        sizeBytes: buffer.byteLength,
        durationSeconds,
        transcript: null,
        transcriptionStatus: TranscriptionStatus.PENDING,
        transcriptionError: null,
        transcribedAt: null,
      },
      create: {
        appointmentId: appointment.id,
        bookingCode: appointment.bookingCode,
        filePath: objectPath,
        mimeType: "audio/wav",
        sizeBytes: buffer.byteLength,
        durationSeconds,
      },
    });
  } catch (error) {
    await removeStorageObjects([objectPath]).catch((cleanupError) => {
      console.error("Failed to clean up visit-reason recording", cleanupError);
    });
    throw error;
  }

  if (appointment.recording?.filePath && appointment.recording.filePath !== objectPath) {
    await removeStorageObjects([appointment.recording.filePath]).catch((error) => {
      console.error("Failed to remove replaced visit-reason recording", error);
    });
  }

  void transcribeRecording(recording.id, buffer).catch((error) => {
    console.error("Visit reason transcription failed", error);
  });

  return NextResponse.json({
    message: "Recording saved.",
    recordingId: recording.id,
    transcriptionStatus: recording.transcriptionStatus,
  });
}

function isWavFile(file: File) {
  return file.type === "audio/wav" || file.type === "audio/wave" || file.name.toLowerCase().endsWith(".wav");
}

function hasWavHeader(buffer: Buffer) {
  return (
    buffer.length > 44 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

async function transcribeRecording(recordingId: string, audioBuffer: Buffer) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    await markTranscriptionFailed(recordingId, "OPENAI_API_KEY is not configured.");
    return;
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
  const language = process.env.OPENAI_TRANSCRIPTION_LANGUAGE || "";
  const body = new FormData();
  const audioArrayBuffer = new ArrayBuffer(audioBuffer.byteLength);
  new Uint8Array(audioArrayBuffer).set(audioBuffer);

  body.set("file", new Blob([audioArrayBuffer], { type: "audio/wav" }), "visit-reason.wav");
  body.set("response_format", "json");
  if (language) {
    body.set("language", language);
  }
  if (model) {
    body.set("model", model);
  }

  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const message =
        typeof payload === "string"
          ? payload
          : payload?.error?.message ?? payload?.detail ?? "OpenAI transcription failed.";
      await markTranscriptionFailed(recordingId, String(message).slice(0, 500));
      return;
    }

    const transcript = typeof payload === "string" ? payload : payload?.text;

    await prisma.visitReasonRecording.update({
      where: { id: recordingId },
      data: {
        transcript: typeof transcript === "string" ? transcript.trim() : "",
        transcriptionStatus: TranscriptionStatus.COMPLETED,
        transcriptionError: null,
        transcribedAt: new Date(),
      },
    });
  } catch (error) {
    await markTranscriptionFailed(recordingId, error instanceof Error ? error.message.slice(0, 500) : "Unknown error");
  }
}

async function markTranscriptionFailed(recordingId: string, transcriptionError: string) {
  await prisma.visitReasonRecording.update({
    where: { id: recordingId },
    data: {
      transcriptionStatus: TranscriptionStatus.FAILED,
      transcriptionError,
      transcribedAt: new Date(),
    },
  });
}
