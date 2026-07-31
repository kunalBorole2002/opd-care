import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateOpdSlots, getOpdSessionHours, opdSessions, type OpdSession } from "@/lib/opd-slots";

export async function GET() {
  const now = new Date();
  const doctors = await prisma.doctor.findMany({
    orderBy: [{ department: "asc" }, { name: "asc" }],
    include: {
      sessionLocations: {
        include: { location: true },
        orderBy: { session: "asc" },
      },
      appointments: {
        where: {
          startsAt: {
            gte: now,
          },
        },
        select: {
          startsAt: true,
        },
      },
    },
  });

  const departments = Array.from(new Set(doctors.map((doctor) => doctor.department)));

  return NextResponse.json({
    departments,
    periods: (Object.entries(opdSessions) as [OpdSession, (typeof opdSessions)[OpdSession]][]).map(
      ([id, period]) => ({
        id,
        label: period.label,
        hours: getOpdSessionHours(id),
      }),
    ),
    doctors: doctors.map((doctor) => ({
      id: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      department: doctor.department,
      experienceYears: doctor.experienceYears,
      fee: doctor.fee,
      sessionLocations: doctor.sessionLocations.map((assignment) => ({
        session: assignment.session.toLowerCase(),
        location: assignment.location,
      })),
      slots: generateOpdSlots(doctor.id, now).map((slot) => ({
        id: slot.id,
        startsAt: slot.startsAt.toISOString(),
        session: slot.session,
        available: !doctor.appointments.some(
          (appointment) => appointment.startsAt.getTime() === slot.startsAt.getTime(),
        ),
      })),
    })),
  });
}
