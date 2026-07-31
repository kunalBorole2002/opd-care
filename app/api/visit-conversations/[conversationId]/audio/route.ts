import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE } from "@/lib/doctor-auth";
import { prisma } from "@/lib/prisma";
import { downloadStorageObject } from "@/lib/supabase-storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const cookieStore = await cookies();
  const doctorId = cookieStore.get(DOCTOR_SESSION_COOKIE)?.value;

  if (!doctorId) {
    return NextResponse.json({ message: "Doctor login is required." }, { status: 401 });
  }

  const conversation = await prisma.visitConversation.findUnique({
    where: { id: conversationId },
    include: {
      appointment: {
        select: {
          doctorId: true,
          bookingCode: true,
        },
      },
    },
  });

  if (!conversation || conversation.appointment.doctorId !== doctorId) {
    return NextResponse.json({ message: "Conversation recording is not available for this doctor." }, { status: 403 });
  }

  if (conversation.sizeBytes === 0) {
    return NextResponse.json(
      { message: "Audio is unavailable for this transcript-only demo record." },
      { status: 404 },
    );
  }

  try {
    const audio = await downloadStorageObject(conversation.recordingPath);
    const range = request.headers.get("range");
    const extension = path.extname(conversation.recordingPath).replace(/^\./, "") || "webm";
    const baseHeaders = {
      "Content-Type": conversation.mimeType,
      "Content-Disposition": `inline; filename="${safeFileName(`${conversation.appointment.bookingCode}-conversation.${extension}`)}"`,
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
    return NextResponse.json({ message: "Conversation recording file could not be read." }, { status: 404 });
  }
}

function safeFileName(value: string) {
  return value.replace(/[^\w.\- ]/g, "_").slice(0, 140) || "conversation-recording.webm";
}
