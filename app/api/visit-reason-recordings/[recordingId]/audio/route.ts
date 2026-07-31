import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ recordingId: string }> },
) {
  const { recordingId } = await params;
  const cookieStore = await cookies();
  const doctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (!doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  const recording = await prisma.visitReasonRecording.findUnique({
    where: { id: recordingId },
    include: {
      appointment: {
        select: {
          doctorId: true,
          bookingCode: true,
        },
      },
    },
  });

  if (!recording || recording.appointment.doctorId !== doctorId) {
    return NextResponse.json({ message: "Recording is not available for this doctor." }, { status: 403 });
  }

  const absolutePath = getRecordingPath(recording.filePath);

  try {
    const audio = await readFile(absolutePath);
    const range = request.headers.get("range");
    const baseHeaders = {
      "Content-Type": recording.mimeType,
      "Content-Disposition": `inline; filename="${recording.appointment.bookingCode}-reason.wav"`,
      "Cache-Control": "private, max-age=300",
      "Accept-Ranges": "bytes",
    };

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : audio.byteLength - 1;

      if (Number.isInteger(start) && Number.isInteger(end) && start <= end && end < audio.byteLength) {
        return new NextResponse(audio.subarray(start, end + 1), {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${audio.byteLength}`,
          },
        });
      }
    }

    return new NextResponse(audio, {
      headers: {
        ...baseHeaders,
        "Content-Length": String(audio.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ message: "Recording file could not be read." }, { status: 404 });
  }
}

function getRecordingPath(storedPath: string) {
  const storageRoot = path.resolve(process.cwd(), "storage", "visit-reason-recordings");
  const fileName = storedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? storedPath;

  return path.join(storageRoot, fileName);
}
