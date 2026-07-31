import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { TestExtractionStatus } from "@prisma/client";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";
import { removeStorageObjects, storageObjectPath, uploadStorageObject } from "@/lib/supabase-storage";

export const runtime = "nodejs";

type ExtractedObservation = {
  name?: string;
  value?: string;
  unit?: string;
  referenceRange?: string;
  flag?: string;
  interpretation?: string;
  confidence?: number | null;
};

type ExtractedTestResult = {
  reportTitle?: string;
  testName?: string;
  labName?: string;
  specimen?: string;
  collectedAtText?: string;
  reportedAtText?: string;
  overallImpression?: string;
  rawText?: string;
  observations?: ExtractedObservation[];
  panels?: unknown[];
  extractionWarnings?: string[];
};

type DeleteTestPayload = {
  doctorId?: string;
  testResultId?: string;
};

const modelName = "nvidia/llama-3.1-nemotron-nano-vl-8b-v1";
const maxFiles = 8;
const maxFileBytes = 8 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { message: "NVIDIA_API_KEY is not configured. Add it to .env and restart the dev server." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const doctorId = String(formData.get("doctorId") ?? "");
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const testName = String(formData.get("testName") ?? "").trim();
  const files = formData.getAll("images").filter((value): value is File => value instanceof File);

  if (!doctorId || !appointmentId || !testName || !files.length) {
    return NextResponse.json({ message: "Test name, appointment, doctor, and result images are required." }, { status: 400 });
  }

  const authError = await validateDoctorSession(doctorId);
  if (authError) return authError;

  if (files.length > maxFiles) {
    return NextResponse.json({ message: `Upload ${maxFiles} images or fewer for one test report.` }, { status: 400 });
  }

  const invalidFile = files.find((file) => file.size <= 0 || file.size > maxFileBytes || !isAllowedImage(file));
  if (invalidFile) {
    return NextResponse.json(
      { message: "Each test image must be a JPG, PNG, or WebP file up to 8 MB." },
      { status: 400 },
    );
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, bookingCode: true },
  });

  if (!appointment || appointment.doctorId !== doctorId) {
    return NextResponse.json({ message: "Appointment is not available for this doctor." }, { status: 403 });
  }

  const visitFolderName = sanitizePathSegment(appointment.bookingCode);
  if (!visitFolderName) {
    return NextResponse.json({ message: "Appointment visit ID is invalid." }, { status: 400 });
  }

  const filePayloads = await Promise.all(
    files.map(async (file, index) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const extension = extensionForMimeType(file.type);
      const fileName = `${Date.now()}-${index + 1}-${randomUUID()}${extension}`;
      const objectPath = storageObjectPath("test-results", visitFolderName, fileName);

      return {
        file,
        buffer,
        objectPath,
      };
    }),
  );

  const uploadedPaths: string[] = [];
  let savedTest;

  try {
    for (const payload of filePayloads) {
      await uploadStorageObject({
        objectPath: payload.objectPath,
        body: payload.buffer,
        contentType: payload.file.type,
      });
      uploadedPaths.push(payload.objectPath);
    }

    savedTest = await prisma.$transaction(async (tx) => {
      const record = await tx.clinicalRecord.upsert({
        where: { appointmentId },
        update: {},
        create: { appointmentId },
      });

      return tx.clinicalTestResult.create({
        data: {
          clinicalRecordId: record.id,
          testName,
          extractionStatus: TestExtractionStatus.PENDING,
          images: {
            create: filePayloads.map(({ file, buffer, objectPath }) => ({
              filePath: objectPath,
              originalName: file.name || "test-result-image",
              mimeType: file.type || "application/octet-stream",
              sizeBytes: buffer.byteLength,
            })),
          },
        },
        include: { images: true },
      });
    });
  } catch (error) {
    await removeStorageObjects(uploadedPaths).catch((cleanupError) => {
      console.error("Failed to clean up test-result uploads", cleanupError);
    });
    throw error;
  }

  try {
    const extracted = normalizeExtractedResult(
      await extractTestResult({
        apiKey,
        testName,
        images: filePayloads.map(({ file, buffer }) => ({
          mimeType: file.type,
          base64: buffer.toString("base64"),
        })),
      }),
    );

    const updated = await prisma.clinicalTestResult.update({
      where: { id: savedTest.id },
      data: {
        reportTitle: clean(extracted.reportTitle),
        labName: clean(extracted.labName),
        specimen: clean(extracted.specimen),
        collectedAtText: clean(extracted.collectedAtText),
        reportedAtText: clean(extracted.reportedAtText),
        overallImpression: clean(extracted.overallImpression),
        rawText: clean(extracted.rawText),
        observationsJson: JSON.stringify(extracted.observations),
        panelsJson: JSON.stringify(extracted.panels ?? []),
        extractionJson: JSON.stringify(extracted),
        extractionWarnings: JSON.stringify(extracted.extractionWarnings ?? []),
        extractionStatus: TestExtractionStatus.COMPLETED,
        extractionError: null,
        modelName,
        extractedAt: new Date(),
      },
      include: { images: true },
    });

    return NextResponse.json({
      message: "Test result extracted and saved.",
      testResult: serializeTestResult(updated),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown extraction error.";
    const failed = await prisma.clinicalTestResult.update({
      where: { id: savedTest.id },
      data: {
        extractionStatus: TestExtractionStatus.FAILED,
        extractionError: message,
        modelName,
      },
      include: { images: true },
    });

    console.error("Test result extraction failed", error);
    return NextResponse.json(
      {
        message: "Images were saved, but AI extraction failed.",
        testResult: serializeTestResult(failed),
      },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as DeleteTestPayload;
  const doctorId = body.doctorId ?? "";
  const testResultId = body.testResultId ?? "";

  if (!doctorId || !testResultId) {
    return NextResponse.json({ message: "Doctor and test result are required." }, { status: 400 });
  }

  const authError = await validateDoctorSession(doctorId);
  if (authError) return authError;

  const testResult = await prisma.clinicalTestResult.findUnique({
    where: { id: testResultId },
    include: {
      images: true,
      clinicalRecord: {
        include: {
          appointment: {
            select: {
              doctorId: true,
            },
          },
        },
      },
    },
  });

  if (!testResult || testResult.clinicalRecord.appointment.doctorId !== doctorId) {
    return NextResponse.json({ message: "Test result is not available for this doctor." }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicalTestImage.deleteMany({
      where: { testResultId },
    });
    await tx.clinicalTestResult.delete({
      where: { id: testResultId },
    });
  });

  await removeStorageObjects(testResult.images.map((image) => image.filePath)).catch((error) => {
    console.error("Failed to remove test-result images from Supabase Storage", error);
  });

  return NextResponse.json({ message: "Test result deleted." });
}

async function extractTestResult({
  apiKey,
  testName,
  images,
}: {
  apiKey: string;
  testName: string;
  images: { mimeType: string; base64: string }[];
}) {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });

  const completion = await client.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Extract this medical test report for a doctor's portal.",
              "Return only valid JSON, without markdown.",
              "Do not assume a fixed test template. Preserve every measurable result as an observation row.",
              "Capture values exactly as shown, including text results, numeric values, units, reference ranges, flags, specimen, collection/report dates, lab name, and free-text impressions.",
              "If a field is missing or unreadable, omit it or add a concise extraction warning. Do not invent values.",
              "Use this JSON shape:",
              JSON.stringify({
                reportTitle: "Short report title if visible",
                testName: "Canonical test/report name inferred from image or doctor input",
                labName: "Lab or hospital name if visible",
                specimen: "Specimen/sample if visible",
                collectedAtText: "Collection date/time exactly as shown",
                reportedAtText: "Report date/time exactly as shown",
                overallImpression: "Clinically relevant summary from the report, no diagnosis invention",
                rawText: "Readable OCR text from report",
                observations: [
                  {
                    name: "Analyte or observation name",
                    value: "Result value exactly as shown",
                    unit: "Unit if shown",
                    referenceRange: "Reference range if shown",
                    flag: "High | Low | Positive | Negative | Critical | Abnormal | Normal | empty if not shown",
                    interpretation: "Short interpretation tied only to visible value/range",
                    confidence: 0.9,
                  },
                ],
                panels: [{ name: "Panel/section name", observations: ["Names included in that section"] }],
                extractionWarnings: ["Unreadable areas, missing ranges, handwriting uncertainty"],
              }),
              `Doctor entered test name: ${testName}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
          ...images.map((image) => ({
            type: "image_url",
            image_url: {
              url: `data:${image.mimeType};base64,${image.base64}`,
            },
          })),
        ],
      },
    ],
    temperature: 0.05,
    top_p: 0.01,
    max_tokens: 4096,
    stream: false,
  } as never);

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("The extraction model returned an empty response.");

  try {
    return JSON.parse(content) as ExtractedTestResult;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The extraction model did not return valid JSON.");
    return JSON.parse(match[0]) as ExtractedTestResult;
  }
}

function normalizeExtractedResult(value: ExtractedTestResult): Required<ExtractedTestResult> {
  return {
    reportTitle: normalizeText(value.reportTitle),
    testName: normalizeText(value.testName),
    labName: normalizeText(value.labName),
    specimen: normalizeText(value.specimen),
    collectedAtText: normalizeText(value.collectedAtText),
    reportedAtText: normalizeText(value.reportedAtText),
    overallImpression: normalizeText(value.overallImpression),
    rawText: normalizeText(value.rawText),
    observations: normalizeObservations(value.observations),
    panels: Array.isArray(value.panels) ? value.panels.slice(0, 30) : [],
    extractionWarnings: normalizeStringArray(value.extractionWarnings, 12),
  };
}

function normalizeObservations(value: ExtractedObservation[] | undefined) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      name: normalizeText(item.name).slice(0, 140),
      value: normalizeText(item.value).slice(0, 140),
      unit: normalizeText(item.unit).slice(0, 60),
      referenceRange: normalizeText(item.referenceRange).slice(0, 140),
      flag: normalizeText(item.flag).slice(0, 60),
      interpretation: normalizeText(item.interpretation).slice(0, 240),
      confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) ? item.confidence : null,
    }))
    .filter((item) => item.name || item.value)
    .slice(0, 120);
}

function serializeTestResult(testResult: {
  id: string;
  testName: string;
  reportTitle: string | null;
  labName: string | null;
  specimen: string | null;
  collectedAtText: string | null;
  reportedAtText: string | null;
  overallImpression: string | null;
  rawText: string | null;
  observationsJson: string;
  panelsJson: string;
  extractionWarnings: string;
  extractionStatus: TestExtractionStatus;
  extractionError: string | null;
  modelName: string | null;
  extractedAt: Date | null;
  createdAt: Date;
  images: { id: string; originalName: string; mimeType: string; sizeBytes: number }[];
}) {
  return {
    id: testResult.id,
    testName: testResult.testName,
    reportTitle: testResult.reportTitle ?? "",
    labName: testResult.labName ?? "",
    specimen: testResult.specimen ?? "",
    collectedAtText: testResult.collectedAtText ?? "",
    reportedAtText: testResult.reportedAtText ?? "",
    overallImpression: testResult.overallImpression ?? "",
    rawText: testResult.rawText ?? "",
    observations: parseJsonArray(testResult.observationsJson),
    panels: parseJsonArray(testResult.panelsJson),
    extractionWarnings: parseJsonArray(testResult.extractionWarnings),
    extractionStatus: testResult.extractionStatus,
    extractionError: testResult.extractionError ?? "",
    modelName: testResult.modelName ?? "",
    extractedAt: testResult.extractedAt?.toISOString() ?? null,
    createdAt: testResult.createdAt.toISOString(),
    images: testResult.images.map((image) => ({
      ...image,
      imageUrl: `/api/doctor-tests/${image.id}/image`,
    })),
  };
}

async function validateDoctorSession(doctorId: string | undefined | null) {
  if (!doctorId) {
    return NextResponse.json({ message: "Doctor is required." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionDoctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (sessionDoctorId !== doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  return null;
}

function isAllowedImage(file: File) {
  return allowedMimeTypes.has(file.type);
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function sanitizePathSegment(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function normalizeStringArray(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(normalizeText).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
