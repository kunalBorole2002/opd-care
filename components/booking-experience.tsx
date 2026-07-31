"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  HeartPulse,
  IndianRupee,
  Loader2,
  MapPin,
  QrCode,
  ShieldCheck,
  Stethoscope,
  Timer,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOpdDateKey, getOpdHour, OPD_TIME_ZONE } from "@/lib/opd-slots";
import { cn } from "@/lib/utils";

type Gender = "Female" | "Male" | "Other";
type VisitPeriod = "morning" | "afternoon" | "evening";

type PatientForm = {
  name: string;
  phone: string;
  age: string;
  gender: Gender | "";
  visitReason: string;
  visitDate: string;
};

type DoctorSlot = {
  id: string;
  startsAt: string;
  session: VisitPeriod;
  available: boolean;
};

type ClinicLocation = {
  id: string;
  name: string;
  addressLine1: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
};

type SessionLocation = {
  session: VisitPeriod;
  location: ClinicLocation;
};

type Doctor = {
  id: string;
  name: string;
  specialty: string;
  department: string;
  experienceYears: number;
  fee: number;
  sessionLocations: SessionLocation[];
  slots: DoctorSlot[];
};

type PeriodOption = {
  id: VisitPeriod;
  label: string;
  hours: number[];
};

type BookingData = {
  departments: string[];
  periods: PeriodOption[];
  doctors: Doctor[];
};

type BookingReceipt = {
  patient: string;
  phone: string;
  practitioner: string;
  specialty: string;
  timeSlot: string;
  location: ClinicLocation;
  visitReason: string;
};

const defaultPeriods: PeriodOption[] = [
  { id: "morning", label: "Morning", hours: [9, 10, 11] },
  { id: "afternoon", label: "Afternoon", hours: [12, 13, 14] },
  { id: "evening", label: "Evening", hours: [16, 17, 18] },
];

function createInitialForm(): PatientForm {
  return {
    name: "",
    phone: "",
    age: "",
    gender: "",
    visitReason: "",
    visitDate: getTodayDateKey(),
  };
}

export function BookingExperience() {
  const [form, setForm] = useState<PatientForm>(() => createInitialForm());
  const [data, setData] = useState<BookingData>({ departments: [], periods: defaultPeriods, doctors: [] });
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [practitionerExpanded, setPractitionerExpanded] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<VisitPeriod | "">("");
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [bookingCode, setBookingCode] = useState(() => createBookingCode());
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadBookingData = useCallback(async (preferredDate = getTodayDateKey()) => {
    try {
      const response = await fetch("/api/booking-data");
      const nextData = (await response.json()) as BookingData;
      setData({
        ...nextData,
        periods: nextData.periods?.length ? nextData.periods : defaultPeriods,
      });
      const preferredDoctor = nextData.doctors.find((doctor) => doctor.id === selectedDoctorId);
      const nextDates = getDoctorDates(preferredDoctor?.slots ?? []);
      if (preferredDoctor && nextDates.length && !nextDates.some((date) => date.value === preferredDate)) {
        setForm((current) => ({ ...current, visitDate: nextDates[0].value }));
      }
    } catch {
      setMessage("Could not load doctors. Run the database seed and refresh.");
    } finally {
      setLoading(false);
    }
  }, [selectedDoctorId]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadBookingData();
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [loadBookingData]);

  const visibleDoctors = useMemo(
    () =>
      departmentFilter
        ? data.doctors.filter((doctor) => doctor.department === departmentFilter)
        : data.doctors,
    [data.doctors, departmentFilter],
  );

  const selectedDoctor = data.doctors.find((doctor) => doctor.id === selectedDoctorId);
  const dateOptions = useMemo(() => getDoctorDates(selectedDoctor?.slots ?? []), [selectedDoctor]);
  const dateSlots = (selectedDoctor?.slots ?? []).filter((slot) => getDateKey(slot.startsAt) === form.visitDate);
  const selectedPeriodOption = data.periods.find((period) => period.id === selectedPeriod);
  const selectedHourAvailable =
    selectedPeriod && selectedHour !== null
      ? dateSlots.some(
          (slot) =>
            slot.available &&
            slot.session === selectedPeriod &&
            getOpdHour(slot.startsAt) === selectedHour,
        )
      : false;

  const patientInfoComplete = isPatientDetailsComplete(form);
  const progressValues = [
    selectedDoctorId,
    form.name.trim(),
    form.phone.length === 10 ? form.phone : "",
    Number(form.age) > 0 ? form.age : "",
    form.gender,
    form.visitReason.trim(),
    form.visitDate,
    selectedPeriod,
    selectedHourAvailable ? String(selectedHour) : "",
  ];
  const progress = Math.round((progressValues.filter(Boolean).length / progressValues.length) * 100);
  const isComplete = Boolean(selectedDoctorId) && patientInfoComplete && Boolean(selectedPeriod) && selectedHourAvailable;
  const reviewTimeLabel =
    selectedPeriodOption && selectedHour !== null
      ? `${selectedPeriodOption.label}, ${formatHour(selectedHour)} hour`
      : "";

  function updateField<K extends keyof PatientForm>(key: K, value: PatientForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "visitDate") {
      setSelectedPeriod("");
      setSelectedHour(null);
    }
    resetConfirmation();
  }

  function resetConfirmation() {
    setBookingCode(createBookingCode());
    setReceipt(null);
    setMessage("");
  }

  function startNewBooking() {
    setForm(createInitialForm());
    setDepartmentFilter("");
    setSelectedDoctorId("");
    setPractitionerExpanded(true);
    setSelectedPeriod("");
    setSelectedHour(null);
    setBookingCode(createBookingCode());
    setReceipt(null);
    setMessage("");
    loadBookingData(getTodayDateKey());
  }

  function selectDoctor(doctorId: string) {
    setSelectedDoctorId(doctorId);
    setPractitionerExpanded(false);
    const firstDate = getDoctorDates(data.doctors.find((doctor) => doctor.id === doctorId)?.slots ?? [])[0]?.value;
    setForm((current) => ({ ...current, visitDate: firstDate ?? getTodayDateKey() }));
    setSelectedPeriod("");
    setSelectedHour(null);
    resetConfirmation();
  }

  function selectDepartment(department: string) {
    setDepartmentFilter(department);
    setSelectedDoctorId("");
    setPractitionerExpanded(true);
    setSelectedPeriod("");
    setSelectedHour(null);
    resetConfirmation();
  }

  function selectPeriod(period: VisitPeriod) {
    setSelectedPeriod(period);
    setSelectedHour(null);
    resetConfirmation();
  }

  function selectHour(hour: number) {
    setSelectedHour(hour);
    resetConfirmation();
  }

  async function confirmBooking() {
    if (!isComplete || !bookingCode || submitting || !selectedPeriod || selectedHour === null) return;
    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          age: form.age,
          gender: form.gender,
          visitReason: form.visitReason,
          date: form.visitDate,
          period: selectedPeriod,
          hour: selectedHour,
          doctorId: selectedDoctorId,
          bookingCode,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.message ?? "Could not create booking.");
        return;
      }

      setBookingCode(body.bookingCode);
      setReceipt(body.receipt);
      setMessage("Appointment confirmed.");
      await loadBookingData(form.visitDate);
    } catch {
      setMessage("Could not create booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="flex items-center gap-3 rounded-[22px] border bg-white px-5 py-4 text-sm font-semibold shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading OPD schedule
        </div>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center overflow-x-clip px-3 py-4 text-[13px] sm:px-4 lg:px-5">
        <motion.section
          className="mx-auto flex w-full max-w-[400px] flex-col gap-3"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        >
          <SuccessAlert />
          <ReceiptPanel
            form={form}
            doctor={selectedDoctor}
            locationPreview={selectedDoctor?.sessionLocations.find((assignment) => assignment.session === selectedPeriod)?.location}
            receipt={receipt}
            progress={progress}
            bookingCode={bookingCode}
            reviewTimeLabel={reviewTimeLabel}
            isComplete={isComplete}
            submitting={submitting}
            message=""
            onConfirm={confirmBooking}
            onBookNew={startNewBooking}
            centered
          />
        </motion.section>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full overflow-x-clip px-3 py-3 text-[13px] sm:px-4 lg:px-5">
      <section className="mx-auto grid w-full max-w-[1420px] min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 space-y-3">
          <Header />
          <PractitionerSelection
            departments={data.departments}
            departmentFilter={departmentFilter}
            doctors={visibleDoctors}
            selectedDoctorId={selectedDoctorId}
            expanded={practitionerExpanded}
            onSelectDepartment={selectDepartment}
            onSelectDoctor={selectDoctor}
            onExpand={() => setPractitionerExpanded(true)}
          />

          <PatientDetails form={form} onChange={updateField} />

          {selectedDoctor ? (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 150, damping: 20 }}
              >
                <VisitTimeSelection
                  dateOptions={dateOptions}
                  visitDate={form.visitDate}
                  periods={data.periods}
                  slots={dateSlots}
                  sessionLocations={selectedDoctor.sessionLocations}
                  selectedPeriod={selectedPeriod}
                  selectedHour={selectedHour}
                  onSelectDate={(date) => updateField("visitDate", date)}
                  onSelectPeriod={selectPeriod}
                  onSelectHour={selectHour}
                />
              </motion.div>
            </AnimatePresence>
          ) : null}
        </div>

        <ReceiptPanel
          form={form}
          doctor={selectedDoctor}
          locationPreview={selectedDoctor?.sessionLocations.find((assignment) => assignment.session === selectedPeriod)?.location}
          receipt={receipt}
          progress={progress}
          bookingCode={bookingCode}
          reviewTimeLabel={reviewTimeLabel}
          isComplete={isComplete}
          submitting={submitting}
          message={message}
          onConfirm={confirmBooking}
          onBookNew={startNewBooking}
        />
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="rounded-[14px] border bg-white/90 px-3 py-3 shadow-sm backdrop-blur">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-foreground shadow-sm">
          <HeartPulse className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            CityCare Practitioner Network
          </p>
        </div>
      </div>
    </header>
  );
}

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white text-xs font-semibold text-muted-foreground shadow-sm">
        {number}
      </span>
      <h2 className="min-w-0 text-sm font-semibold text-slate-700">{title}</h2>
    </div>
  );
}

function PatientDetails({
  form,
  onChange,
}: {
  form: PatientForm;
  onChange: <K extends keyof PatientForm>(key: K, value: PatientForm[K]) => void;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle number="02" title="Patient Details" />
      <div className="grid min-w-0 gap-x-3 gap-y-3 lg:grid-cols-2">
        <Field label="Full name">
          <Input
            className="h-9 rounded-[10px] px-2.5 text-xs"
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="Julianne Moore"
          />
        </Field>
        <Field label="Contact number">
          <Input
            className="h-9 rounded-[10px] px-2.5 text-xs"
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="98765 43210"
            inputMode="numeric"
          />
        </Field>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Age">
            <Input
              className="h-9 rounded-[10px] px-2.5 text-xs"
              value={form.age}
              onChange={(event) => onChange("age", event.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="28"
              inputMode="numeric"
            />
          </Field>
          <Field label="Gender">
            <select
              className="h-9 w-full rounded-[10px] border bg-white px-2.5 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={form.gender}
              onChange={(event) => onChange("gender", event.target.value as Gender | "")}
            >
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Reason for visit">
          <Input
            className="h-9 rounded-[10px] px-2.5 text-xs"
            value={form.visitReason}
            onChange={(event) => onChange("visitReason", event.target.value)}
            placeholder="Routine checkup"
          />
        </Field>
      </div>
    </section>
  );
}

function PractitionerSelection({
  departments,
  departmentFilter,
  doctors,
  selectedDoctorId,
  expanded,
  onSelectDepartment,
  onSelectDoctor,
  onExpand,
}: {
  departments: string[];
  departmentFilter: string;
  doctors: Doctor[];
  selectedDoctorId: string;
  expanded: boolean;
  onSelectDepartment: (department: string) => void;
  onSelectDoctor: (doctorId: string) => void;
  onExpand: () => void;
}) {
  const sortedDoctors = useMemo(
    () =>
      [...doctors].sort((firstDoctor, secondDoctor) => {
        const difference =
          firstDoctor.slots.filter((slot) => slot.available).length -
          secondDoctor.slots.filter((slot) => slot.available).length;
        return difference === 0 ? firstDoctor.name.localeCompare(secondDoctor.name) : -difference;
      }),
    [doctors],
  );
  const displayedDoctors = selectedDoctorId && !expanded
    ? sortedDoctors.filter((doctor) => doctor.id === selectedDoctorId)
    : sortedDoctors;

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle number="01" title="Choose Your Practitioner" />
          <p className="ml-8 mt-1 text-xs font-medium text-muted-foreground">
            {selectedDoctorId && !expanded
              ? "Your selected practitioner"
              : "Select a doctor to view their clinics and available schedule."}
          </p>
        </div>
        {selectedDoctorId && !expanded ? (
          <button
            className="h-9 rounded-[11px] border bg-white px-3 text-xs font-bold text-primary transition hover:border-primary/50 hover:bg-secondary"
            type="button"
            onClick={onExpand}
          >
            Change practitioner
          </button>
        ) : (
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          <button
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-xs font-semibold transition",
              !departmentFilter ? "border-primary bg-secondary text-primary" : "bg-white text-muted-foreground",
            )}
            onClick={() => onSelectDepartment("")}
            type="button"
          >
            All departments
          </button>
          {departments.map((department) => (
            <button
              key={department}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 text-xs font-semibold transition",
                departmentFilter === department
                  ? "border-primary bg-secondary text-primary"
                  : "bg-white text-muted-foreground hover:border-primary/50",
              )}
              onClick={() => onSelectDepartment(department)}
              type="button"
            >
              {department}
            </button>
          ))}
        </div>
        )}
      </div>

      <div className={cn("grid min-w-0 gap-3", expanded && "md:grid-cols-2")}>
        {displayedDoctors.map((doctor) => {
          const active = doctor.id === selectedDoctorId;
          const clinicCities = Array.from(
            new Set(doctor.sessionLocations.map((assignment) => assignment.location.city)),
          ).join(", ");
          const clinicCount = new Set(doctor.sessionLocations.map((assignment) => assignment.location.id)).size;
          return (
            <button
              key={doctor.id}
              className={cn(
                "min-w-0 rounded-[16px] border bg-white p-4 text-left shadow-sm transition",
                active
                  ? "border-primary bg-blue-50/50 ring-2 ring-primary/10"
                  : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
              )}
              type="button"
              onClick={() => onSelectDoctor(doctor.id)}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]",
                    active ? "bg-primary text-white" : "bg-secondary text-primary",
                  )}
                >
                  <CircleUserRound className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-900">{doctor.name}</h3>
                      <p className="mt-0.5 text-xs font-semibold text-primary">{doctor.specialty}</p>
                    </div>
                    {active ? (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Timer className="h-3.5 w-3.5 text-primary" />
                      {doctor.experienceYears} years experience
                    </span>
                    {doctor.fee > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <IndianRupee className="h-3.5 w-3.5 text-primary" />
                        {doctor.fee} consultation
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      {clinicCount} {clinicCount === 1 ? "clinic" : "clinics"}
                      {clinicCities ? ` · ${clinicCities}` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function VisitTimeSelection({
  dateOptions,
  visitDate,
  periods,
  slots,
  sessionLocations,
  selectedPeriod,
  selectedHour,
  onSelectDate,
  onSelectPeriod,
  onSelectHour,
}: {
  dateOptions: { value: string; label: string }[];
  visitDate: string;
  periods: PeriodOption[];
  slots: DoctorSlot[];
  sessionLocations: SessionLocation[];
  selectedPeriod: VisitPeriod | "";
  selectedHour: number | null;
  onSelectDate: (date: string) => void;
  onSelectPeriod: (period: VisitPeriod) => void;
  onSelectHour: (hour: number) => void;
}) {
  const selectedPeriodOption = periods.find((period) => period.id === selectedPeriod);
  const selectedLocation = sessionLocations.find((assignment) => assignment.session === selectedPeriod)?.location;

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white text-xs font-semibold text-muted-foreground shadow-sm">
            03
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700">Clinic & Visit Time</h3>
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border bg-white p-3">
        <Field label="Visit date">
          <DateCalendar
            availableDates={dateOptions.map((date) => date.value)}
            selectedDate={visitDate}
            onSelectDate={onSelectDate}
          />
        </Field>
      </div>

      <div className="grid min-w-0 gap-2 rounded-[14px] border bg-white p-3">
        <p className="text-xs font-semibold text-muted-foreground">
          Choose an available consultation time and clinic.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {periods.map((period) => {
            const clinic = sessionLocations.find((assignment) => assignment.session === period.id)?.location;
            const availableCount = slots.filter((slot) => slot.session === period.id && slot.available).length;
            const disabled = !clinic || availableCount === 0;
            const active = selectedPeriod === period.id;
            return (
              <button
                key={period.id}
                className={cn(
                  "min-h-24 rounded-[12px] border px-3 py-3 text-left transition",
                  active ? "border-primary bg-secondary text-primary shadow-sm" : "bg-white hover:border-primary/50",
                  disabled && "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-200",
                )}
                disabled={disabled}
                onClick={() => onSelectPeriod(period.id)}
                type="button"
              >
                <span className="block text-sm font-bold">{period.label}</span>
                <span className="mt-1 block text-[11px] font-semibold">
                  {!clinic ? "Not available" : disabled ? "Booked" : `${availableCount} slots available`}
                </span>
                {clinic ? (
                  <span className="mt-2 flex items-start gap-1.5 border-t border-current/10 pt-2 text-[11px] font-semibold leading-4">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{clinic.name} · {clinic.locality}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedPeriodOption ? (
        <div className="grid min-w-0 gap-2 rounded-[14px] border bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            {selectedPeriodOption.label} hour blocks
          </p>
          <div className="flex max-w-full min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-1">
            {selectedPeriodOption.hours.map((hour) => {
              const availableCount = slots.filter(
                (slot) =>
                  slot.session === selectedPeriodOption.id &&
                  getOpdHour(slot.startsAt) === hour &&
                  slot.available,
              ).length;
              const disabled = availableCount === 0;
              return (
                <button
                  key={hour}
                  className={cn(
                    "flex h-12 w-[118px] shrink-0 items-center justify-center gap-1.5 rounded-[10px] border px-2 text-center text-xs font-semibold transition",
                    selectedHour === hour
                      ? "border-primary bg-secondary text-primary shadow-sm"
                      : "bg-white text-foreground hover:border-primary/50",
                    disabled &&
                      "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-200",
                  )}
                  disabled={disabled}
                  onClick={() => onSelectHour(hour)}
                  type="button"
                >
                  <Clock3 className="h-3.5 w-3.5 shrink-0" />
                  <span>{formatHour(hour)}</span>
                  {disabled ? <span className="text-[10px] font-bold">Booked</span> : null}
                </button>
              );
            })}
          </div>
          {selectedLocation ? (
            <div className="mt-1 flex items-start gap-3 rounded-[12px] border border-blue-100 bg-blue-50/60 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white text-primary shadow-sm">
                <MapPin className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">{selectedLocation.name}</p>
                <p className="mt-1 text-[11px] font-medium leading-4 text-slate-600">
                  {formatAddress(selectedLocation)}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ReceiptPanel({
  form,
  doctor,
  locationPreview,
  receipt,
  progress,
  bookingCode,
  reviewTimeLabel,
  isComplete,
  submitting,
  message,
  onConfirm,
  onBookNew,
  centered = false,
}: {
  form: PatientForm;
  doctor?: Doctor;
  locationPreview?: ClinicLocation;
  receipt: BookingReceipt | null;
  progress: number;
  bookingCode: string;
  reviewTimeLabel: string;
  isComplete: boolean;
  submitting: boolean;
  message: string;
  onConfirm: () => void;
  onBookNew: () => void;
  centered?: boolean;
}) {
  const [exportingReceipt, setExportingReceipt] = useState(false);
  const finalPatient = receipt?.patient ?? form.name;
  const finalDoctor = receipt
    ? `${receipt.practitioner}, ${receipt.specialty}`
    : doctor
      ? `${doctor.name}, ${doctor.specialty}`
      : "Select a practitioner";
  const finalSlot = receipt?.timeSlot;
  const finalLocation = receipt?.location ?? locationPreview;
  const isConfirmed = Boolean(receipt);
  const visibleBookingCode = isComplete ? bookingCode : "";

  async function downloadReceipt() {
    if (!bookingCode || exportingReceipt) return;
    setExportingReceipt(true);

    try {
      const response = await fetch("/api/booking-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingCode }),
      });

      if (!response.ok) {
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${bookingCode}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingReceipt(false);
    }
  }

  return (
    <aside className={cn("min-w-0", centered ? "w-full" : "xl:sticky xl:top-3 xl:h-fit")}>
      <motion.div
        className="min-w-0 rounded-[14px] border bg-white px-3 pb-3 pt-3 shadow-sm sm:px-4"
        initial={centered ? { opacity: 0, x: 44, scale: 0.98 } : { opacity: 1 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 130, damping: 20 }}
      >
        <div className="text-center">
          <h2 className="text-sm font-semibold text-slate-700">Appointment Review</h2>
        </div>

        <div className="mt-5 min-w-0 rounded-[14px] border border-dashed bg-[#f8fbff] p-3 pt-4">
          <div className="flex justify-center">
            <ReceiptQr progress={progress} bookingCode={visibleBookingCode} />
          </div>
          <p className="mt-5 break-all text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Ref: {visibleBookingCode || "BK-PREVIEW-CURA"}
          </p>
        </div>

        <div className="mt-5 divide-y">
          <ReceiptLine label="Practitioner" value={finalDoctor} />
          <ReceiptLine
            label="Visit Time"
            value={finalSlot ? formatSlot(finalSlot) : reviewTimeLabel || "Pick a visit time"}
            mono={!finalSlot && !reviewTimeLabel}
          />
          <ReceiptLine
            label="Clinic"
            value={finalLocation ? `${finalLocation.name} — ${formatAddress(finalLocation)}` : "Clinic shown after time selection"}
          />
          <ReceiptLine label="Patient" value={finalPatient || "Patient details pending"} />
          <ReceiptLine label="Phone" value={receipt?.phone ?? (form.phone || "Phone pending")} />
          <ReceiptLine label="Reason" value={receipt?.visitReason ?? (form.visitReason || "Visit reason pending")} />
        </div>

        {message && !centered ? (
          <div
            className={cn(
              "mt-5 rounded-[14px] border px-3 py-2 text-xs font-semibold",
              isConfirmed ? "border-primary/20 bg-secondary text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {isConfirmed ? (
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" />
                Appointment booked successfully
              </span>
            ) : (
              message
            )}
          </div>
        ) : null}

        <div className="mt-5 grid min-w-0 gap-2">
          {isConfirmed ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button className="h-9 min-w-0 rounded-[11px] text-xs" disabled={!bookingCode || exportingReceipt} onClick={downloadReceipt}>
                {exportingReceipt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Download Receipt
              </Button>
              <Button className="h-9 min-w-0 rounded-[11px] text-xs" onClick={onBookNew} variant="secondary">
                Book New
              </Button>
            </div>
          ) : (
            <Button className="h-9 min-w-0 rounded-[11px] text-xs" disabled={!isComplete || !bookingCode || submitting} onClick={onConfirm}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] leading-4 text-muted-foreground">
          By confirming, you agree to our terms. Cancellations must be made at least 2 hours prior to the slot time.
        </p>
      </motion.div>
    </aside>
  );
}

function SuccessAlert() {
  return (
    <motion.div
      className="rounded-[18px] border border-primary/20 bg-white px-4 py-4 shadow-[0_18px_45px_rgba(37,99,235,0.12)]"
      initial={{ opacity: 0, y: -14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 150, damping: 18 }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <motion.div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
          initial={{ scale: 0.7 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 15 }}
        >
          <Check className="h-6 w-6" />
        </motion.div>
        <div className="min-w-0">
          <p className="text-base font-bold text-foreground">Appointment booked successfully</p>
          <p className="mt-1 text-sm font-medium leading-5 text-muted-foreground">
            Your practitioner and exact visit time are confirmed.
          </p>
        </div>
      </div>
    </motion.div>
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
  const todayKey = getTodayDateKey();
  const canSelectToday = availableDateSet.has(todayKey);
  const monthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  function moveMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function selectToday() {
    if (!canSelectToday) return;
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
          "flex h-9 w-full min-w-0 items-center justify-between gap-3 rounded-[10px] border bg-white px-2.5 text-left text-xs font-semibold text-slate-700 transition",
          open && "border-primary ring-2 ring-primary/15",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{formatCalendarDate(selectedDate)}</span>
        </span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", open && "rotate-90")} />
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-full min-w-[280px] rounded-[18px] border bg-white p-3 shadow-xl sm:w-[320px]">
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
              const hasSlots = availableDateSet.has(day.dateKey);
              const disabled = !hasSlots;

              return (
                <button
                  key={day.dateKey}
                  className={cn(
                    "relative flex aspect-square min-h-9 items-center justify-center rounded-full text-sm font-semibold transition",
                    day.inMonth ? "text-foreground" : "text-muted-foreground/45",
                    active ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-secondary hover:text-primary",
                    today && !active && "ring-1 ring-primary/35",
                    disabled && "cursor-not-allowed text-muted-foreground/35 hover:bg-transparent hover:text-muted-foreground/35",
                  )}
                  disabled={disabled}
                  onClick={() => selectDate(day.dateKey)}
                  type="button"
                  aria-pressed={active}
                >
                  {day.label}
                  {hasSlots ? (
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
            className="mt-3 h-9 w-full rounded-[18px] bg-secondary text-sm font-bold text-primary transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canSelectToday}
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

function ReceiptQr({ progress, bookingCode }: { progress: number; bookingCode: string }) {
  const [previewQr, setPreviewQr] = useState("");
  const [finalQr, setFinalQr] = useState("");

  useEffect(() => {
    QRCode.toDataURL("BK-PREVIEW-CURA", {
      width: 220,
      margin: 1,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    }).then(setPreviewQr);
  }, []);

  useEffect(() => {
    if (!bookingCode) {
      return;
    }

    QRCode.toDataURL(bookingCode, {
      width: 220,
      margin: 1,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
      errorCorrectionLevel: "H",
    }).then(setFinalQr);
  }, [bookingCode]);

  const image = bookingCode ? finalQr : previewQr;

  return (
    <div className="relative flex h-40 w-40 items-center justify-center rounded-[22px] border bg-white p-3 shadow-md">
      {image ? (
        <motion.img
          key={bookingCode || "preview"}
          src={image}
          alt={bookingCode ? "Booking QR code" : "Booking progress QR preview"}
          className="h-full w-full object-contain"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{
            opacity: bookingCode || progress > 0 ? 1 : 0,
            scale: 1,
            clipPath: bookingCode
              ? "inset(0% 0% 0% 0%)"
              : `inset(0% 0% ${100 - progress}% 0%)`,
          }}
          transition={{ type: "spring", stiffness: 110, damping: 22 }}
        />
      ) : (
        <QrCode className="h-12 w-12 text-muted" />
      )}
    </div>
  );
}

function ReceiptLine({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-1 py-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={cn("min-w-0 break-words text-sm font-bold text-foreground sm:text-right", mono && "font-mono")}>
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function isPatientDetailsComplete(form: PatientForm) {
  return Boolean(
    form.name.trim() &&
      form.phone.length === 10 &&
      Number(form.age) > 0 &&
      form.gender &&
      form.visitReason.trim(),
  );
}

function formatAddress(location: ClinicLocation) {
  return [location.addressLine1, location.locality, location.city, location.state, location.postalCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function formatSlot(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: OPD_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatHour(hour: number) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, 0));
}

function getAvailableSlotCount(slots: DoctorSlot[], dateFilter: string) {
  return slots.filter((slot) => getDateKey(slot.startsAt) === dateFilter && slot.available).length;
}

function getAvailableSlotCountForHour(
  slots: DoctorSlot[],
  dateFilter: string,
  period: VisitPeriod,
  hour: number | null,
) {
  if (hour === null) return 0;

  return slots.filter(
    (slot) =>
      getDateKey(slot.startsAt) === dateFilter &&
      slot.session === period &&
      getOpdHour(slot.startsAt) === hour &&
      slot.available,
  ).length;
}

function hasAvailableSlotForHour(
  slots: DoctorSlot[],
  dateFilter: string,
  period: VisitPeriod,
  hour: number | null,
) {
  return getAvailableSlotCountForHour(slots, dateFilter, period, hour) > 0;
}

function getDateKey(value: string) {
  return getOpdDateKey(value);
}

function getTodayDateKey() {
  return getOpdDateKey(new Date());
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
  }).format(parseDateKey(value));
}

function createBookingCode() {
  return `OPD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;
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

function getDoctorDates(slots: DoctorSlot[]) {
  const uniqueDates = Array.from(
    new Set(slots.filter((slot) => slot.available).map((slot) => getDateKey(slot.startsAt))),
  );

  return uniqueDates.map((value) => ({
    value,
    label: new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(new Date(`${value}T00:00:00.000Z`)),
  }));
}
