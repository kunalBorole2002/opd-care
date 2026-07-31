-- Index every foreign-key column not already covered by a unique or composite index.
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

CREATE INDEX "PatientMedicalHistory_patientId_idx" ON "PatientMedicalHistory"("patientId");

CREATE INDEX "PrescriptionItem_clinicalRecordId_idx" ON "PrescriptionItem"("clinicalRecordId");

CREATE INDEX "ClinicalTestImage_testResultId_idx" ON "ClinicalTestImage"("testResultId");
