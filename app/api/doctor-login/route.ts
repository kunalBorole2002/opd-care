import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE, isDoctorAccessCodeValid } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";

type DoctorLoginPayload = {
  doctorId?: string;
  accessCode?: string;
};

export async function GET() {
  const doctors = await prisma.doctor.findMany({
    orderBy: [{ department: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      specialty: true,
      department: true,
    },
  });

  return NextResponse.json({ doctors });
}

export async function POST(request: Request) {
  const body = (await request.json()) as DoctorLoginPayload;

  if (!body.doctorId || !isDoctorAccessCodeValid(body.accessCode)) {
    return NextResponse.json({ message: "Invalid doctor or access code." }, { status: 401 });
  }

  const doctor = await prisma.doctor.findUnique({
    where: { id: body.doctorId },
    select: { id: true },
  });

  if (!doctor) {
    return NextResponse.json({ message: "Invalid doctor or access code." }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(DOCTOR_SESSION_COOKIE, doctor.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 10,
  });

  return NextResponse.json({ destination: `/doctor/${doctor.id}` });
}
