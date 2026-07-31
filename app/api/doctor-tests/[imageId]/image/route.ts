import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";
import { downloadStorageObject } from "@/lib/supabase-storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await params;
  const cookieStore = await cookies();
  const doctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (!doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  const image = await prisma.clinicalTestImage.findUnique({
    where: { id: imageId },
    include: {
      testResult: {
        include: {
          clinicalRecord: {
            include: {
              appointment: {
                select: {
                  doctorId: true,
                  bookingCode: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!image || image.testResult.clinicalRecord.appointment.doctorId !== doctorId) {
    return NextResponse.json({ message: "Test image is not available for this doctor." }, { status: 403 });
  }

  try {
    const file = await downloadStorageObject(image.filePath);

    return new NextResponse(file, {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Disposition": `inline; filename="${safeFileName(image.originalName)}"`,
        "Cache-Control": "private, max-age=300",
        "Content-Length": String(file.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ message: "Test image file could not be read." }, { status: 404 });
  }
}

function safeFileName(value: string) {
  return value.replace(/[^\w.\- ]/g, "_").slice(0, 140) || "test-result-image";
}
