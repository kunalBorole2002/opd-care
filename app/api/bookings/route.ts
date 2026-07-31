import { NextResponse } from "next/server";
import { Gender, OpdSession as PrismaOpdSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOpdHourCandidates, isValidOpdSlot, opdSessions, type OpdSession } from "@/lib/opd-slots";

type BookingPayload = {
  name?: string;
  phone?: string;
  age?: string | number;
  gender?: string;
  visitReason?: string;
  notes?: string;
  doctorId?: string;
  date?: string;
  period?: string;
  hour?: string | number;
  bookingCode?: string;
};

const genderMap: Record<string, Gender> = {
  Female: Gender.FEMALE,
  Male: Gender.MALE,
  Other: Gender.OTHER,
};

const periods = new Set(Object.keys(opdSessions));

export async function POST(request: Request) {
  const body = (await request.json()) as BookingPayload;
  const age = Number(body.age);
  const phone = String(body.phone ?? "").replace(/\D/g, "");
  const gender = body.gender ? genderMap[body.gender] : undefined;
  const period = periods.has(String(body.period)) ? (String(body.period) as OpdSession) : null;
  const hour = Number(body.hour);

  if (
    !body.name?.trim() ||
    phone.length !== 10 ||
    !Number.isInteger(age) ||
    age <= 0 ||
    !gender ||
    !body.visitReason?.trim() ||
    !body.doctorId?.trim() ||
    !body.date?.match(/^\d{4}-\d{2}-\d{2}$/) ||
    !period ||
    !Number.isInteger(hour)
  ) {
    return NextResponse.json({ message: "Missing or invalid booking details." }, { status: 400 });
  }

  const candidateStarts = getOpdHourCandidates(body.date, period, hour).filter((startsAt) =>
    isValidOpdSlot(startsAt),
  );

  if (!candidateStarts.length) {
    return NextResponse.json({ message: "Selected visit time is not available." }, { status: 400 });
  }

  const doctors = await prisma.doctor.findMany({
    where: { id: body.doctorId },
    select: {
      id: true,
      name: true,
      specialty: true,
      sessionLocations: {
        where: { session: period.toUpperCase() as PrismaOpdSession },
        select: { locationId: true, location: true },
      },
    },
  });

  if (!doctors.length) {
    return NextResponse.json({ message: "Selected practitioner is not available." }, { status: 400 });
  }

  const sessionLocation = doctors[0].sessionLocations[0];
  if (!sessionLocation) {
    return NextResponse.json({ message: "This practitioner has no clinic for the selected session." }, { status: 400 });
  }

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      doctorId: {
        in: doctors.map((doctor) => doctor.id),
      },
      startsAt: {
        in: candidateStarts,
      },
    },
    select: {
      doctorId: true,
      startsAt: true,
    },
  });

  const bookedKeys = new Set(
    existingAppointments.map((appointment) => `${appointment.doctorId}-${appointment.startsAt.getTime()}`),
  );
  const assignment = doctors
    .flatMap((doctor) =>
      candidateStarts.map((startsAt) => ({
        doctor,
        startsAt,
      })),
    )
    .find(({ doctor, startsAt }) => !bookedKeys.has(`${doctor.id}-${startsAt.getTime()}`));

  if (!assignment) {
    return NextResponse.json({ message: "Selected visit time is fully booked." }, { status: 409 });
  }

  const requestedBookingCode = body.bookingCode?.trim().toUpperCase();
  const bookingCode = requestedBookingCode?.match(/^OPD-[A-Z0-9]+-[A-Z0-9]{5}$/)
    ? requestedBookingCode
    : createBookingCode();

  try {
    const appointment = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.upsert({
        where: { phone },
        update: {
          name: body.name!.trim(),
          age,
          gender,
        },
        create: {
          name: body.name!.trim(),
          phone,
          age,
          gender,
        },
      });

      return tx.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: assignment.doctor.id,
          locationId: sessionLocation.locationId,
          startsAt: assignment.startsAt,
          visitReason: body.visitReason!.trim(),
          notes: body.notes?.trim() || null,
          bookingCode,
        },
        include: {
          patient: true,
          doctor: true,
          location: true,
        },
      });
    });

    return NextResponse.json({
      bookingCode: appointment.bookingCode,
      receipt: {
        patient: appointment.patient.name,
        phone: appointment.patient.phone,
        practitioner: appointment.doctor.name,
        specialty: appointment.doctor.specialty,
        timeSlot: appointment.startsAt.toISOString(),
        location: appointment.location,
        visitReason: appointment.visitReason,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ message: "This visit time was just booked. Please choose another time." }, { status: 409 });
    }

    return NextResponse.json({ message: "Could not create booking." }, { status: 500 });
  }
}

function createBookingCode() {
  return `OPD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;
}
