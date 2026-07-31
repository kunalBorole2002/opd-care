import { NextResponse } from "next/server";
import QRCode from "qrcode";
import sharp from "sharp";
import { OPD_TIME_ZONE } from "@/lib/opd-slots";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReceiptRequest = {
  bookingCode?: string;
};

type ReceiptLocation = {
  name: string;
  addressLine1: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ReceiptRequest;
  const bookingCode = body.bookingCode?.trim().toUpperCase();

  if (!bookingCode?.match(/^OPD-[A-Z0-9-]{5,80}$/)) {
    return NextResponse.json({ message: "Missing or invalid booking code." }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { bookingCode },
    include: {
      doctor: true,
      patient: true,
      location: true,
    },
  });

  if (!appointment) {
    return NextResponse.json({ message: "Receipt was not found." }, { status: 404 });
  }

  const qrBuffer = await QRCode.toBuffer(appointment.bookingCode, {
    width: 320,
    margin: 1,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
    errorCorrectionLevel: "H",
  });

  const receiptSvg = buildReceiptSvg({
    bookingCode: appointment.bookingCode,
    createdAt: appointment.createdAt,
    doctor: `${appointment.doctor.name}, ${appointment.doctor.specialty}`,
    department: appointment.doctor.department,
    location: appointment.location,
    patient: appointment.patient.name,
    phone: appointment.patient.phone,
    qrImage: `data:image/png;base64,${qrBuffer.toString("base64")}`,
    slot: appointment.startsAt,
    visitReason: appointment.visitReason,
  });

  const image = await sharp(Buffer.from(receiptSvg), { density: 144 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const imageBuffer = new ArrayBuffer(image.byteLength);
  new Uint8Array(imageBuffer).set(image);

  return new NextResponse(new Blob([imageBuffer], { type: "image/png" }), {
    headers: {
      "Content-Disposition": `attachment; filename="${appointment.bookingCode}.png"`,
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}

function buildReceiptSvg({
  bookingCode,
  createdAt,
  doctor,
  department,
  location,
  patient,
  phone,
  qrImage,
  slot,
  visitReason,
}: {
  bookingCode: string;
  createdAt: Date;
  doctor: string;
  department: string;
  location: ReceiptLocation;
  patient: string;
  phone: string;
  qrImage: string;
  slot: Date;
  visitReason: string;
}) {
  const details = [
    ["Patient", patient],
    ["Phone", phone],
    ["Practitioner", doctor],
    ["Department", department],
    ["Clinic", location.name],
    ["Address", formatAddress(location)],
    ["Visit reason", visitReason],
    ["Issued", formatDateTime(createdAt)],
  ];
  const detailCards = details
    .map(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      return renderDetailCard(label, value, 70 + column * 540, 610 + row * 145);
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
  <rect width="1200" height="1500" fill="#eef5ff"/>
  <rect x="40" y="35" width="1120" height="1430" rx="28" fill="#ffffff" stroke="#cdddf2" stroke-width="2"/>

  <path d="M68 35h1064a28 28 0 0 1 28 28v180H40V63a28 28 0 0 1 28-28z" fill="#eff6ff"/>
  <rect x="74" y="84" width="82" height="82" rx="20" fill="#1d4ed8"/>
  <path d="M115 105c-18-20-42 4-24 23l24 24 24-24c18-19-6-43-24-23z" fill="none" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>
  <text x="184" y="105" fill="#1d4ed8" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">CITYCARE PRACTITIONER NETWORK</text>
  <text x="184" y="153" fill="#172033" font-family="Arial, sans-serif" font-size="42" font-weight="700">OPD Appointment Receipt</text>
  <rect x="916" y="97" width="180" height="52" rx="26" fill="#f0fdf4" stroke="#86efac" stroke-width="2"/>
  <circle cx="947" cy="123" r="8" fill="#16a34a"/>
  <text x="970" y="131" fill="#166534" font-family="Arial, sans-serif" font-size="20" font-weight="700">CONFIRMED</text>

  <rect x="70" y="280" width="1060" height="285" rx="24" fill="#f8fbff" stroke="#dbeafe" stroke-width="2"/>
  <rect x="105" y="315" width="215" height="215" rx="18" fill="#ffffff" stroke="#dbeafe" stroke-width="2"/>
  <image href="${qrImage}" x="120" y="330" width="185" height="185"/>
  <text x="370" y="354" fill="#64748b" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3">APPOINTMENT TIME</text>
  ${renderText(formatDateTime(slot), 370, 410, 42, 36, 2, "#0f172a", 700)}
  <text x="370" y="505" fill="#475569" font-family="monospace" font-size="24" font-weight="700">Ref: ${escapeXml(bookingCode)}</text>

  ${detailCards}

  <rect x="70" y="1210" width="1060" height="165" rx="22" fill="#f8fbff" stroke="#dbeafe" stroke-width="2"/>
  <circle cx="112" cy="1255" r="22" fill="#dbeafe"/>
  <text x="104" y="1264" fill="#1d4ed8" font-family="Arial, sans-serif" font-size="28" font-weight="700">+</text>
  <text x="150" y="1264" fill="#172033" font-family="Arial, sans-serif" font-size="25" font-weight="700">Reception instructions</text>
  <text x="105" y="1315" fill="#475569" font-family="Arial, sans-serif" font-size="20">✓ Show this receipt at reception.</text>
  <text x="600" y="1315" fill="#475569" font-family="Arial, sans-serif" font-size="20">✓ Carry a valid ID.</text>
  <text x="105" y="1350" fill="#475569" font-family="Arial, sans-serif" font-size="20">✓ Arrive 10 minutes early.</text>
  <text x="600" y="1350" fill="#475569" font-family="Arial, sans-serif" font-size="20">✓ Keep the QR code visible.</text>

  <line x1="70" y1="1405" x2="1130" y2="1405" stroke="#e2e8f0" stroke-width="2"/>
  <text x="70" y="1440" fill="#64748b" font-family="Arial, sans-serif" font-size="16">Generated securely by CityCare Practitioner Network.</text>
</svg>`;
}

function renderDetailCard(label: string, value: string, x: number, y: number) {
  return `<rect x="${x}" y="${y}" width="520" height="125" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
  <text x="${x + 24}" y="${y + 34}" fill="#64748b" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${escapeXml(label.toUpperCase())}</text>
  ${renderText(value || "—", x + 24, y + 72, 23, 32, 2, "#172033", 700)}`;
}

function renderText(
  value: string,
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  maxLines: number,
  color: string,
  fontWeight: number,
) {
  const maxCharacters = Math.max(12, Math.floor(475 / (fontSize * 0.56)));
  const lines = wrapText(value, maxCharacters, maxLines);
  return `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("")}</text>`;
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];

  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maxCharacters) {
      if (lines.length === maxLines) {
        const last = lines[maxLines - 1];
        lines[maxLines - 1] = `${last.slice(0, Math.max(1, maxCharacters - 1))}…`;
        break;
      }
      lines.push(word.slice(0, maxCharacters));
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }

  return lines.length ? lines : ["—"];
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: OPD_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatAddress(location: ReceiptLocation) {
  return [location.addressLine1, location.locality, location.city, location.state, location.postalCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
