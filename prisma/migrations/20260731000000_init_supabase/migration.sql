-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppointmentVisitType" AS ENUM ('INITIAL', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "OpdSession" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "CopilotAnalysisMode" AS ENUM ('LOAD_ANALYSIS', 'CONSULT_ANALYSIS');

-- CreateEnum
CREATE TYPE "TestExtractionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TranscriptionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VisitConversationStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'LABELING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClinicalNotesGenerationStatus" AS ENUM ('IDLE', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" "Gender" NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "experienceYears" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorSessionLocation" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "session" "OpdSession" NOT NULL,

    CONSTRAINT "DoctorSessionLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "followUpFromId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "visitReason" TEXT NOT NULL,
    "visitType" "AppointmentVisitType" NOT NULL DEFAULT 'INITIAL',
    "notes" TEXT,
    "bookingCode" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAiAnalysis" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "mode" "CopilotAnalysisMode" NOT NULL,
    "summary" TEXT NOT NULL,
    "vitalsAnalysisJson" TEXT NOT NULL DEFAULT '[]',
    "historyAnalysisJson" TEXT NOT NULL DEFAULT '[]',
    "riskFlagsJson" TEXT NOT NULL DEFAULT '[]',
    "suggestedQuestionsJson" TEXT NOT NULL DEFAULT '[]',
    "clinicalSnapshotJson" TEXT,
    "modelName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientAiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientMedicalHistory" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientMedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalRecord" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "diagnosis" TEXT,
    "observations" TEXT,
    "followUpNotes" TEXT,
    "diagnosisAiDraft" TEXT,
    "observationsAiDraft" TEXT,
    "followUpNotesAiDraft" TEXT,
    "clinicalNotesGenerationStatus" "ClinicalNotesGenerationStatus" NOT NULL DEFAULT 'IDLE',
    "clinicalNotesGenerationError" TEXT,
    "clinicalNotesModelName" TEXT,
    "clinicalNotesGeneratedAt" TIMESTAMP(3),
    "clinicalNotesDraftVersion" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalVital" (
    "id" TEXT NOT NULL,
    "clinicalRecordId" TEXT NOT NULL,
    "bloodPressure" TEXT,
    "pulse" INTEGER,
    "temperature" TEXT,
    "spo2" INTEGER,
    "weight" TEXT,

    CONSTRAINT "ClinicalVital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "clinicalRecordId" TEXT NOT NULL,
    "medicine" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "route" TEXT,
    "frequency" TEXT NOT NULL,
    "timing" TEXT,
    "mealTiming" TEXT,
    "duration" TEXT NOT NULL,
    "quantity" TEXT,
    "instructions" TEXT,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalTestResult" (
    "id" TEXT NOT NULL,
    "clinicalRecordId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "doctorResultNotes" TEXT,
    "reportTitle" TEXT,
    "labName" TEXT,
    "specimen" TEXT,
    "collectedAtText" TEXT,
    "reportedAtText" TEXT,
    "overallImpression" TEXT,
    "rawText" TEXT,
    "observationsJson" TEXT NOT NULL DEFAULT '[]',
    "panelsJson" TEXT NOT NULL DEFAULT '[]',
    "extractionJson" TEXT NOT NULL DEFAULT '{}',
    "extractionWarnings" TEXT NOT NULL DEFAULT '[]',
    "extractionStatus" "TestExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractionError" TEXT,
    "modelName" TEXT,
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalTestImage" (
    "id" TEXT NOT NULL,
    "testResultId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalTestImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitReasonRecording" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "bookingCode" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "transcript" TEXT,
    "transcriptionStatus" "TranscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "transcriptionError" TEXT,
    "transcribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitReasonRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitConversation" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "bookingCode" TEXT NOT NULL,
    "attemptLabel" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "recordingPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "status" "VisitConversationStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "rawTranscript" TEXT,
    "speakerJson" TEXT,
    "plainTranscript" TEXT,
    "language" TEXT,
    "modelName" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitConversationChunk" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "transcriptPath" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "transcript" TEXT,
    "status" "TranscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "transcribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitConversationChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_phone_key" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "DoctorSessionLocation_locationId_idx" ON "DoctorSessionLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorSessionLocation_doctorId_session_key" ON "DoctorSessionLocation"("doctorId", "session");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_bookingCode_key" ON "Appointment"("bookingCode");

-- CreateIndex
CREATE INDEX "Appointment_locationId_idx" ON "Appointment"("locationId");

-- CreateIndex
CREATE INDEX "Appointment_followUpFromId_idx" ON "Appointment"("followUpFromId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_doctorId_startsAt_key" ON "Appointment"("doctorId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAiAnalysis_appointmentId_key" ON "PatientAiAnalysis"("appointmentId");

-- CreateIndex
CREATE INDEX "PatientAiAnalysis_patientId_updatedAt_idx" ON "PatientAiAnalysis"("patientId", "updatedAt");

-- CreateIndex
CREATE INDEX "PatientAiAnalysis_doctorId_updatedAt_idx" ON "PatientAiAnalysis"("doctorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalRecord_appointmentId_key" ON "ClinicalRecord"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalVital_clinicalRecordId_key" ON "ClinicalVital"("clinicalRecordId");

-- CreateIndex
CREATE INDEX "ClinicalTestResult_clinicalRecordId_createdAt_idx" ON "ClinicalTestResult"("clinicalRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitReasonRecording_appointmentId_key" ON "VisitReasonRecording"("appointmentId");

-- CreateIndex
CREATE INDEX "VisitConversation_appointmentId_createdAt_idx" ON "VisitConversation"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "VisitConversation_bookingCode_createdAt_idx" ON "VisitConversation"("bookingCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitConversationChunk_conversationId_chunkIndex_key" ON "VisitConversationChunk"("conversationId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "DoctorSessionLocation" ADD CONSTRAINT "DoctorSessionLocation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSessionLocation" ADD CONSTRAINT "DoctorSessionLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_followUpFromId_fkey" FOREIGN KEY ("followUpFromId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAiAnalysis" ADD CONSTRAINT "PatientAiAnalysis_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAiAnalysis" ADD CONSTRAINT "PatientAiAnalysis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAiAnalysis" ADD CONSTRAINT "PatientAiAnalysis_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalRecord" ADD CONSTRAINT "ClinicalRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalVital" ADD CONSTRAINT "ClinicalVital_clinicalRecordId_fkey" FOREIGN KEY ("clinicalRecordId") REFERENCES "ClinicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_clinicalRecordId_fkey" FOREIGN KEY ("clinicalRecordId") REFERENCES "ClinicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalTestResult" ADD CONSTRAINT "ClinicalTestResult_clinicalRecordId_fkey" FOREIGN KEY ("clinicalRecordId") REFERENCES "ClinicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalTestImage" ADD CONSTRAINT "ClinicalTestImage_testResultId_fkey" FOREIGN KEY ("testResultId") REFERENCES "ClinicalTestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitReasonRecording" ADD CONSTRAINT "VisitReasonRecording_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitConversation" ADD CONSTRAINT "VisitConversation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitConversationChunk" ADD CONSTRAINT "VisitConversationChunk_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "VisitConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep application tables private. Runtime access is exclusively through server-side Prisma.
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "Patient" FROM anon, authenticated;

ALTER TABLE "Doctor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "Doctor" FROM anon, authenticated;

ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "Location" FROM anon, authenticated;

ALTER TABLE "DoctorSessionLocation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "DoctorSessionLocation" FROM anon, authenticated;

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "Appointment" FROM anon, authenticated;

ALTER TABLE "PatientAiAnalysis" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "PatientAiAnalysis" FROM anon, authenticated;

ALTER TABLE "PatientMedicalHistory" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "PatientMedicalHistory" FROM anon, authenticated;

ALTER TABLE "ClinicalRecord" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ClinicalRecord" FROM anon, authenticated;

ALTER TABLE "ClinicalVital" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ClinicalVital" FROM anon, authenticated;

ALTER TABLE "PrescriptionItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "PrescriptionItem" FROM anon, authenticated;

ALTER TABLE "ClinicalTestResult" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ClinicalTestResult" FROM anon, authenticated;

ALTER TABLE "ClinicalTestImage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ClinicalTestImage" FROM anon, authenticated;

ALTER TABLE "VisitReasonRecording" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "VisitReasonRecording" FROM anon, authenticated;

ALTER TABLE "VisitConversation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "VisitConversation" FROM anon, authenticated;

ALTER TABLE "VisitConversationChunk" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "VisitConversationChunk" FROM anon, authenticated;

