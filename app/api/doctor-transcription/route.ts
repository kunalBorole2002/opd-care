import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const maxFileBytes = 12 * 1024 * 1024;
const maxDurationSeconds = 30;
const defaultModel = "whisper-1";
const allowedAudioMimeTypes = new Set([
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/ogg",
  "audio/x-m4a",
]);

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { message: "OPENAI_API_KEY is not configured. Add it to .env and restart the dev server." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const doctorId = String(formData.get("doctorId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "").trim();
  const language = String(formData.get("language") ?? "").trim();
  const durationSeconds = Math.ceil(Number(formData.get("durationSeconds") ?? 0));
  const file = formData.get("file");

  if ((!appointmentId && !doctorId) || !fieldId || !(file instanceof File)) {
    return NextResponse.json({ message: "Doctor or appointment, field, and recording are required." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > maxFileBytes || !isAllowedAudio(file)) {
    return NextResponse.json(
      { message: "Recording must be a supported audio file up to 12 MB." },
      { status: 400 },
    );
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDurationSeconds) {
    return NextResponse.json({ message: "Recording must be 30 seconds or less." }, { status: 400 });
  }

  let authorizedDoctorId = doctorId;

  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, doctorId: true },
    });

    if (!appointment) {
      return NextResponse.json({ message: "Appointment not found." }, { status: 404 });
    }

    authorizedDoctorId = appointment.doctorId;
  }

  const authError = await validateDoctorSession(authorizedDoctorId);
  if (authError) return authError;

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || defaultModel;
  const transcriptionBody = new FormData();

  transcriptionBody.set("file", file, file.name || `doctor-dictation.${extensionForAudio(file)}`);
  transcriptionBody.set("model", model);
  transcriptionBody.set("response_format", "json");
  if (language) {
    transcriptionBody.set("language", language);
  }

  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: transcriptionBody,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const message =
        typeof payload === "string"
          ? payload
          : payload?.error?.message ?? payload?.detail ?? "OpenAI transcription failed.";
      return NextResponse.json({ message: String(message).slice(0, 500) }, { status: 502 });
    }

    const text = typeof payload === "string" ? payload : payload?.text;

    return NextResponse.json({
      fieldId,
      model,
      text: typeof text === "string" ? text.trim() : "",
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not reach OpenAI transcription service." },
      { status: 502 },
    );
  }
}

async function validateDoctorSession(doctorId: string) {
  const cookieStore = await cookies();
  const sessionDoctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (sessionDoctorId !== doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  return null;
}

function isAllowedAudio(file: File) {
  return allowedAudioMimeTypes.has(file.type) || /\.(m4a|mp3|mp4|ogg|opus|wav|webm)$/i.test(file.name);
}

function extensionForAudio(file: File) {
  if (file.type.includes("webm")) return "webm";
  if (file.type.includes("wav")) return "wav";
  if (file.type.includes("mpeg") || file.type.includes("mp3")) return "mp3";
  if (file.type.includes("ogg")) return "ogg";
  if (file.type.includes("mp4") || file.type.includes("m4a")) return "m4a";
  return "webm";
}
