import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AppointmentStatus, AppointmentVisitType, CopilotAnalysisMode, Gender, OpdSession } from "@prisma/client";
import { generateClinicalNotesForConversation } from "@/lib/clinical-note-generation";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { getOpdSession } from "@/lib/opd-slots";
import { prisma } from "@/lib/prisma";

type PrescriptionPayload = {
  medicine?: string;
  dosage?: string;
  route?: string;
  frequency?: string;
  timing?: string;
  mealTiming?: string;
  duration?: string;
  quantity?: string;
  instructions?: string;
};

type DashboardPayload = {
  action?:
    | "start"
    | "save"
    | "complete"
    | "addHistory"
    | "deleteHistory"
    | "saveVitals"
    | "addAppointment"
    | "createFollowUp"
    | "scanQr"
    | "saveClinicalNote"
    | "verifyClinicalNote"
    | "generateClinicalNotes";
  doctorId?: string;
  appointmentId?: string;
  bookingCode?: string;
  patientId?: string;
  slotStartsAt?: string;
  patient?: {
    name?: string;
    phone?: string;
    age?: string | number;
    gender?: string;
    visitReason?: string;
  };
  historyId?: string;
  diagnosis?: string;
  observations?: string;
  followUpNotes?: string;
  noteField?: "diagnosis" | "observations" | "followUpNotes";
  noteValue?: string;
  draftVersion?: string;
  durationSeconds?: number;
  vitals?: {
    bloodPressure?: string;
    pulse?: string | number;
    temperature?: string;
    spo2?: string | number;
    weight?: string;
  };
  prescriptions?: PrescriptionPayload[];
  history?: {
    title?: string;
    detail?: string;
  };
};

const genderMap: Record<string, Gender> = {
  Female: Gender.FEMALE,
  Male: Gender.MALE,
  Other: Gender.OTHER,
  FEMALE: Gender.FEMALE,
  MALE: Gender.MALE,
  OTHER: Gender.OTHER,
};
export async function GET(request: Request) {
  const doctorId = new URL(request.url).searchParams.get("doctorId") ?? "";
  const authError = await validateDoctorSession(doctorId);
  if (authError) return authError;

  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      name: true,
      specialty: true,
      department: true,
    },
  });

  if (!doctor) {
    return NextResponse.json({ message: "Doctor not found." }, { status: 404 });
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: {
        in: [
          AppointmentStatus.CONFIRMED,
          "WAITING" as AppointmentStatus,
          AppointmentStatus.IN_PROGRESS,
          AppointmentStatus.COMPLETED,
        ],
      },
    },
    orderBy: {
      startsAt: "asc",
    },
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
        include: {
          vitals: true,
          prescriptions: true,
          testResults: {
            include: {
              images: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          },
        },
      },
      aiAnalysis: true,
    },
  });

  return NextResponse.json({
    doctor,
    appointments: appointments.map((appointment) => ({
      id: appointment.id,
      bookingCode: appointment.bookingCode,
      visitReason: appointment.visitReason,
      visitType: appointment.visitType,
      followUpFromId: appointment.followUpFromId,
      status: appointment.status,
      notes: appointment.notes,
      doctor: {
        id: appointment.doctor.id,
        name: appointment.doctor.name,
        specialty: appointment.doctor.specialty,
        department: appointment.doctor.department,
      },
      patient: {
        id: appointment.patient.id,
        name: appointment.patient.name,
        phone: appointment.patient.phone,
        age: appointment.patient.age,
        gender: appointment.patient.gender,
        medicalHistory: appointment.patient.medicalHistory.map((entry) => ({
          id: entry.id,
          title: entry.title,
          detail: entry.detail,
          recordedAt: entry.recordedAt.toISOString(),
        })),
      },
      slot: {
        id: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
      },
      clinicalRecord: appointment.clinicalRecord
        ? {
            id: appointment.clinicalRecord.id,
            diagnosis: appointment.clinicalRecord.diagnosis ?? "",
            observations: appointment.clinicalRecord.observations ?? "",
            followUpNotes: appointment.clinicalRecord.followUpNotes ?? "",
            diagnosisAiDraft: appointment.clinicalRecord.diagnosisAiDraft ?? "",
            observationsAiDraft: appointment.clinicalRecord.observationsAiDraft ?? "",
            followUpNotesAiDraft: appointment.clinicalRecord.followUpNotesAiDraft ?? "",
            clinicalNotesGenerationStatus: appointment.clinicalRecord.clinicalNotesGenerationStatus,
            clinicalNotesGenerationError: appointment.clinicalRecord.clinicalNotesGenerationError ?? "",
            clinicalNotesModelName: appointment.clinicalRecord.clinicalNotesModelName ?? "",
            clinicalNotesGeneratedAt: appointment.clinicalRecord.clinicalNotesGeneratedAt?.toISOString() ?? null,
            clinicalNotesDraftVersion: appointment.clinicalRecord.clinicalNotesDraftVersion ?? "",
            startedAt: appointment.clinicalRecord.startedAt?.toISOString() ?? null,
            completedAt: appointment.clinicalRecord.completedAt?.toISOString() ?? null,
            durationSeconds: appointment.clinicalRecord.durationSeconds ?? 0,
            vitals: {
              bloodPressure: appointment.clinicalRecord.vitals?.bloodPressure ?? "",
              pulse: appointment.clinicalRecord.vitals?.pulse?.toString() ?? "",
              temperature: appointment.clinicalRecord.vitals?.temperature ?? "",
              spo2: appointment.clinicalRecord.vitals?.spo2?.toString() ?? "",
              weight: appointment.clinicalRecord.vitals?.weight ?? "",
            },
            prescriptions: appointment.clinicalRecord.prescriptions.map((item) => ({
              id: item.id,
              medicine: item.medicine,
              dosage: item.dosage,
              route: item.route ?? "",
              frequency: item.frequency,
              timing: item.timing ?? "",
              mealTiming: item.mealTiming ?? "",
              duration: item.duration,
              quantity: item.quantity ?? "",
              instructions: item.instructions ?? "",
            })),
            testResults: appointment.clinicalRecord.testResults.map((item) => ({
              id: item.id,
              testName: item.testName,
              reportTitle: item.reportTitle ?? "",
              labName: item.labName ?? "",
              specimen: item.specimen ?? "",
              collectedAtText: item.collectedAtText ?? "",
              reportedAtText: item.reportedAtText ?? "",
              overallImpression: item.overallImpression ?? "",
              rawText: item.rawText ?? "",
              observations: parseStoredJsonArray(item.observationsJson),
              panels: parseStoredJsonArray(item.panelsJson),
              extractionWarnings: parseStoredStringArray(item.extractionWarnings),
              extractionStatus: item.extractionStatus,
              extractionError: item.extractionError ?? "",
              modelName: item.modelName ?? "",
              extractedAt: item.extractedAt?.toISOString() ?? null,
              createdAt: item.createdAt.toISOString(),
              images: item.images.map((image) => ({
                id: image.id,
                originalName: image.originalName,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                imageUrl: `/api/doctor-tests/${image.id}/image`,
              })),
            })),
          }
        : null,
      aiAnalysis: appointment.aiAnalysis
        ? {
            id: appointment.aiAnalysis.id,
            mode: fromAnalysisMode(appointment.aiAnalysis.mode),
            summary: appointment.aiAnalysis.summary,
            vitalsAnalysis: parseStoredStringArray(appointment.aiAnalysis.vitalsAnalysisJson),
            historyAnalysis: parseStoredStringArray(appointment.aiAnalysis.historyAnalysisJson),
            riskFlags: parseStoredStringArray(appointment.aiAnalysis.riskFlagsJson),
            suggestedQuestions: parseStoredStringArray(appointment.aiAnalysis.suggestedQuestionsJson),
            modelName: appointment.aiAnalysis.modelName,
            generatedAt: appointment.aiAnalysis.generatedAt.toISOString(),
            updatedAt: appointment.aiAnalysis.updatedAt.toISOString(),
          }
        : null,
    })),
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as DashboardPayload;

  if (!body.action) {
    return NextResponse.json({ message: "Appointment action is required." }, { status: 400 });
  }

  const authError = await validateDoctorSession(body.doctorId);
  if (authError) return authError;

  if (body.action === "addAppointment") {
    const age = Number(body.patient?.age);
    const phone = String(body.patient?.phone ?? "").replace(/\D/g, "");
    const gender = body.patient?.gender ? genderMap[body.patient.gender] : undefined;
    const startsAt = new Date(body.slotStartsAt ?? "");

    if (
      !body.doctorId ||
      !body.patient?.name?.trim() ||
      phone.length !== 10 ||
      !Number.isInteger(age) ||
      age <= 0 ||
      !gender ||
      !body.patient?.visitReason?.trim() ||
      Number.isNaN(startsAt.getTime())
    ) {
      return NextResponse.json({ message: "Patient and slot details are required." }, { status: 400 });
    }

    const session = getOpdSession(startsAt);
    const sessionLocation = session
      ? await prisma.doctorSessionLocation.findUnique({
          where: {
            doctorId_session: {
              doctorId: body.doctorId,
              session: session.toUpperCase() as OpdSession,
            },
          },
          select: { locationId: true },
        })
      : null;

    if (!sessionLocation) {
      return NextResponse.json({ message: "This practitioner has no clinic for the selected session." }, { status: 400 });
    }

    const appointment = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.upsert({
        where: { phone },
        update: {
          name: body.patient!.name!.trim(),
          age,
          gender,
        },
        create: {
          name: body.patient!.name!.trim(),
          phone,
          age,
          gender,
        },
      });

      return tx.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: body.doctorId!,
          locationId: sessionLocation.locationId,
          startsAt,
          visitReason: body.patient!.visitReason!.trim(),
          bookingCode: createBookingCode(),
        },
        select: {
          id: true,
          bookingCode: true,
        },
      });
    });

    return NextResponse.json({
      message: "Patient added to slot.",
      appointmentId: appointment.id,
      bookingCode: appointment.bookingCode,
    });
  }

  if (body.action === "scanQr") {
    const bookingCode = body.bookingCode?.trim().toUpperCase() ?? "";

    if (!/^OPD-[A-Z0-9]+-[A-Z0-9]+$/.test(bookingCode)) {
      return NextResponse.json({ message: "This QR is not a valid hospital booking QR." }, { status: 400 });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { bookingCode },
      include: {
        patient: true,
        doctor: true,
      },
    });

    if (!appointment || appointment.doctorId !== body.doctorId) {
      return NextResponse.json({ message: "This QR does not belong to this doctor queue." }, { status: 404 });
    }

    if (appointment.status !== AppointmentStatus.CONFIRMED && appointment.status !== ("WAITING" as AppointmentStatus)) {
      return NextResponse.json(
        { message: `This patient is already ${appointment.status.replace("_", " ").toLowerCase()}.` },
        { status: 409 },
      );
    }

    const canMarkWaiting = appointment.status === AppointmentStatus.CONFIRMED;
    const updatedAppointment = canMarkWaiting
      ? await prisma.appointment.update({
          where: { id: appointment.id },
          data: { status: "WAITING" as AppointmentStatus },
          include: {
            patient: true,
            doctor: true,
          },
        })
      : appointment;

    return NextResponse.json({
      message: canMarkWaiting ? "Patient checked in and moved to waiting." : "Patient is already checked in.",
      appointment: {
        id: updatedAppointment.id,
        bookingCode: updatedAppointment.bookingCode,
        visitReason: updatedAppointment.visitReason,
        status: updatedAppointment.status,
        patient: {
          id: updatedAppointment.patient.id,
          name: updatedAppointment.patient.name,
          phone: updatedAppointment.patient.phone,
          age: updatedAppointment.patient.age,
          gender: updatedAppointment.patient.gender,
        },
        slot: {
          startsAt: updatedAppointment.startsAt.toISOString(),
        },
        doctor: {
          id: updatedAppointment.doctor.id,
          name: updatedAppointment.doctor.name,
          specialty: updatedAppointment.doctor.specialty,
          department: updatedAppointment.doctor.department,
        },
      },
    });
  }

  if (!body.appointmentId) {
    return NextResponse.json({ message: "Appointment is required." }, { status: 400 });
  }
  const appointmentId = body.appointmentId;
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      doctorId: true,
      patientId: true,
      locationId: true,
      status: true,
      visitReason: true,
    },
  });

  if (!appointment || appointment.doctorId !== body.doctorId) {
    return NextResponse.json({ message: "Appointment is not available for this doctor." }, { status: 403 });
  }

  if (body.action === "createFollowUp") {
    if (appointment.status !== AppointmentStatus.COMPLETED) {
      return NextResponse.json(
        { message: "Only a completed appointment can be followed up." },
        { status: 409 },
      );
    }

    const startsAt = new Date();
    const followUpReason = toFollowUpReason(appointment.visitReason);

    const followUp = await prisma.appointment.create({
      data: {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        locationId: appointment.locationId,
        followUpFromId: appointment.id,
        startsAt,
        visitReason: followUpReason,
        visitType: AppointmentVisitType.FOLLOW_UP,
        bookingCode: createBookingCode(),
        status: AppointmentStatus.WAITING,
      },
      select: {
        id: true,
        startsAt: true,
        bookingCode: true,
      },
    });

    return NextResponse.json({
      message: "Follow-up added to today's waiting queue.",
      appointmentId: followUp.id,
      startsAt: followUp.startsAt.toISOString(),
      bookingCode: followUp.bookingCode,
    });
  }

  if (body.action === "addHistory") {
    if (
      !body.patientId ||
      body.patientId !== appointment.patientId ||
      !body.history?.title?.trim() ||
      !body.history?.detail?.trim()
    ) {
      return NextResponse.json({ message: "Patient history details are required." }, { status: 400 });
    }

    await prisma.patientMedicalHistory.create({
      data: {
        patientId: body.patientId,
        title: body.history.title.trim(),
        detail: body.history.detail.trim(),
      },
    });

    return NextResponse.json({ message: "Patient history added." });
  }

  if (body.action === "deleteHistory") {
    if (!body.historyId) {
      return NextResponse.json({ message: "Patient history item is required." }, { status: 400 });
    }

    const historyItem = await prisma.patientMedicalHistory.findUnique({
      where: { id: body.historyId },
      select: { patientId: true },
    });

    if (!historyItem || historyItem.patientId !== appointment.patientId) {
      return NextResponse.json({ message: "Patient history item is not available for this doctor." }, { status: 403 });
    }

    const deleted = await prisma.patientMedicalHistory.deleteMany({
      where: { id: body.historyId },
    });

    return NextResponse.json({
      message: deleted.count ? "Patient history deleted." : "Patient history item already removed.",
    });
  }

  if (body.action === "start") {
    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.WAITING
    ) {
      return NextResponse.json(
        { message: "Only a confirmed or waiting appointment can be started." },
        { status: 409 },
      );
    }

    const startedAt = new Date();
    const record = await prisma.$transaction(async (tx) => {
      const clinicalRecord = await tx.clinicalRecord.upsert({
        where: { appointmentId },
        update: {
          startedAt,
          completedAt: null,
          durationSeconds: 0,
          diagnosisAiDraft: null,
          observationsAiDraft: null,
          followUpNotesAiDraft: null,
          clinicalNotesGenerationStatus: "IDLE",
          clinicalNotesGenerationError: null,
          clinicalNotesModelName: null,
          clinicalNotesGeneratedAt: null,
          clinicalNotesDraftVersion: null,
        },
        create: {
          appointmentId,
          startedAt,
          durationSeconds: 0,
        },
      });

      await tx.patientAiAnalysis.deleteMany({
        where: { appointmentId },
      });

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.IN_PROGRESS },
      });

      return clinicalRecord;
    });

    return NextResponse.json({
      clinicalRecord: {
        id: record.id,
        startedAt: record.startedAt?.toISOString() ?? null,
      },
    });
  }

  if (body.action === "saveVitals") {
    const record = await prisma.clinicalRecord.upsert({
      where: { appointmentId },
      update: {},
      create: { appointmentId },
    });

    await prisma.clinicalVital.upsert({
      where: { clinicalRecordId: record.id },
      update: parseVitals(body.vitals),
      create: {
        clinicalRecordId: record.id,
        ...parseVitals(body.vitals),
      },
    });

    return NextResponse.json({
      message: "Vitals saved.",
      clinicalRecordId: record.id,
    });
  }

  if (body.action === "generateClinicalNotes") {
    const conversation = await prisma.visitConversation.findFirst({
      where: { appointmentId, status: "COMPLETED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });

    if (!conversation) {
      return NextResponse.json({ message: "The completed transcript is not ready yet." }, { status: 409 });
    }

    const result = await generateClinicalNotesForConversation(conversation.id);
    const record = await prisma.clinicalRecord.findUnique({
      where: { appointmentId },
      select: clinicalNotesSelect,
    });

    return NextResponse.json({
      message: result.status === "failed" ? "Clinical-note generation failed." : "Clinical notes generated.",
      clinicalNotes: serializeClinicalNotes(record),
    });
  }

  if (body.action === "saveClinicalNote" || body.action === "verifyClinicalNote") {
    if (!isClinicalNoteField(body.noteField)) {
      return NextResponse.json({ message: "Clinical-note field is required." }, { status: 400 });
    }

    const field = body.noteField;
    await prisma.clinicalRecord.upsert({
      where: { appointmentId },
      update: {},
      create: { appointmentId },
    });
    const record = await prisma.clinicalRecord.findUnique({
      where: { appointmentId },
      select: clinicalNotesSelect,
    });

    if (!record) return NextResponse.json({ message: "Clinical record could not be created." }, { status: 500 });

    if (body.action === "verifyClinicalNote") {
      const verifiedValue = combineClinicalNote(record[field], record[aiDraftField(field)]);
      await updateClinicalNoteField(appointmentId, field, verifiedValue, true);
    } else {
      const draftWasVisible =
        Boolean(body.draftVersion) &&
        body.draftVersion === record.clinicalNotesDraftVersion &&
        Boolean(record[aiDraftField(field)]);

      await updateClinicalNoteField(appointmentId, field, body.noteValue ?? "", draftWasVisible);
    }

    const updated = await prisma.clinicalRecord.findUnique({
      where: { appointmentId },
      select: clinicalNotesSelect,
    });

    return NextResponse.json({
      message: body.action === "verifyClinicalNote" ? "Clinical note verified." : "Clinical note saved.",
      clinicalNotes: serializeClinicalNotes(updated),
    });
  }

  const saved = await prisma.$transaction(async (tx) => {
    const record = await tx.clinicalRecord.upsert({
      where: { appointmentId },
      update: {
        diagnosis: clean(body.diagnosis),
        observations: clean(body.observations),
        followUpNotes: clean(body.followUpNotes),
        completedAt: body.action === "complete" ? new Date() : undefined,
        durationSeconds: Number.isFinite(body.durationSeconds) ? Number(body.durationSeconds) : undefined,
      },
      create: {
        appointmentId,
        diagnosis: clean(body.diagnosis),
        observations: clean(body.observations),
        followUpNotes: clean(body.followUpNotes),
        completedAt: body.action === "complete" ? new Date() : undefined,
        durationSeconds: Number.isFinite(body.durationSeconds) ? Number(body.durationSeconds) : undefined,
      },
    });

    await tx.clinicalVital.upsert({
      where: { clinicalRecordId: record.id },
      update: parseVitals(body.vitals),
      create: {
        clinicalRecordId: record.id,
        ...parseVitals(body.vitals),
      },
    });

    await tx.prescriptionItem.deleteMany({
      where: { clinicalRecordId: record.id },
    });

    const prescriptions = (body.prescriptions ?? [])
      .map((item) => ({
        medicine: item.medicine?.trim() ?? "",
        dosage: item.dosage?.trim() ?? "",
        route: clean(item.route),
        frequency: item.frequency?.trim() ?? "",
        timing: clean(item.timing),
        mealTiming: clean(item.mealTiming),
        duration: item.duration?.trim() ?? "",
        quantity: clean(item.quantity),
        instructions: clean(item.instructions),
      }))
      .filter((item) => item.medicine && item.dosage && item.frequency && item.duration);

    if (prescriptions.length) {
      await tx.prescriptionItem.createMany({
        data: prescriptions.map((item) => ({
          clinicalRecordId: record.id,
          ...item,
        })),
      });
    }

    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: body.action === "complete" ? AppointmentStatus.COMPLETED : AppointmentStatus.IN_PROGRESS,
      },
    });

    return record;
  });

  return NextResponse.json({
    message: body.action === "complete" ? "Appointment completed." : "Clinical record saved.",
    clinicalRecordId: saved.id,
  });
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

function createBookingCode() {
  return `OPD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;
}

function toFollowUpReason(visitReason: string) {
  const reasonWithoutPrefix = visitReason.replace(/^follow[\s-]*up\s*:\s*/i, "").trim();
  return `Follow-up: ${reasonWithoutPrefix || "Visit"}`;
}

const clinicalNotesSelect = {
  diagnosis: true,
  observations: true,
  followUpNotes: true,
  diagnosisAiDraft: true,
  observationsAiDraft: true,
  followUpNotesAiDraft: true,
  clinicalNotesGenerationStatus: true,
  clinicalNotesGenerationError: true,
  clinicalNotesGeneratedAt: true,
  clinicalNotesDraftVersion: true,
} as const;

type ClinicalNoteField = "diagnosis" | "observations" | "followUpNotes";
type ClinicalNoteAiDraftField = "diagnosisAiDraft" | "observationsAiDraft" | "followUpNotesAiDraft";

function isClinicalNoteField(value: unknown): value is ClinicalNoteField {
  return value === "diagnosis" || value === "observations" || value === "followUpNotes";
}

function aiDraftField(field: ClinicalNoteField): ClinicalNoteAiDraftField {
  if (field === "diagnosis") return "diagnosisAiDraft";
  if (field === "observations") return "observationsAiDraft";
  return "followUpNotesAiDraft";
}

async function updateClinicalNoteField(
  appointmentId: string,
  field: ClinicalNoteField,
  value: string,
  clearAiDraft: boolean,
) {
  const normalized = clean(value);

  if (field === "diagnosis") {
    return prisma.clinicalRecord.update({
      where: { appointmentId },
      data: {
        diagnosis: normalized,
        ...(clearAiDraft ? { diagnosisAiDraft: null } : {}),
      },
    });
  }

  if (field === "observations") {
    return prisma.clinicalRecord.update({
      where: { appointmentId },
      data: {
        observations: normalized,
        ...(clearAiDraft ? { observationsAiDraft: null } : {}),
      },
    });
  }

  return prisma.clinicalRecord.update({
    where: { appointmentId },
    data: {
      followUpNotes: normalized,
      ...(clearAiDraft ? { followUpNotesAiDraft: null } : {}),
    },
  });
}

function serializeClinicalNotes(
  record:
    | {
        diagnosis: string | null;
        observations: string | null;
        followUpNotes: string | null;
        diagnosisAiDraft: string | null;
        observationsAiDraft: string | null;
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
    diagnosis: combineClinicalNote(record.diagnosis, record.diagnosisAiDraft),
    observations: combineClinicalNote(record.observations, record.observationsAiDraft),
    followUpNotes: combineClinicalNote(record.followUpNotes, record.followUpNotesAiDraft),
    unverified: {
      diagnosis: Boolean(record.diagnosisAiDraft),
      observations: Boolean(record.observationsAiDraft),
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

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseVitals(vitals: DashboardPayload["vitals"]) {
  return {
    bloodPressure: clean(vitals?.bloodPressure),
    pulse: toNumber(vitals?.pulse),
    temperature: clean(vitals?.temperature),
    spo2: toNumber(vitals?.spo2),
    weight: clean(vitals?.weight),
  };
}

function toNumber(value: string | number | undefined) {
  if (value === "" || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromAnalysisMode(mode: CopilotAnalysisMode) {
  return mode === CopilotAnalysisMode.CONSULT_ANALYSIS ? "consultAnalysis" : "loadAnalysis";
}

function parseStoredStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseStoredJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
