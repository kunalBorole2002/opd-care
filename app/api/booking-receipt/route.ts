import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReceiptRequest = {
  bookingCode?: string;
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

  const qrImage = await QRCode.toDataURL(appointment.bookingCode, {
    width: 320,
    margin: 1,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
    errorCorrectionLevel: "H",
  });

  const html = buildReceiptHtml({
    bookingCode: appointment.bookingCode,
    createdAt: appointment.createdAt,
    doctor: `${appointment.doctor.name}, ${appointment.doctor.specialty}`,
    department: appointment.doctor.department,
    location: appointment.location,
    patient: appointment.patient.name,
    phone: appointment.patient.phone,
    qrImage,
    slot: appointment.startsAt,
    visitReason: appointment.visitReason,
  });

  const browser = await puppeteer.launch({
    args: [
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-setuid-sandbox",
      "--font-render-hinting=none",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--no-sandbox",
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: "shell",
    pipe: true,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 920, height: 1280, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });

    const receipt = await page.$("#receipt");
    if (!receipt) {
      return NextResponse.json({ message: "Could not render receipt." }, { status: 500 });
    }

    const image = await receipt.screenshot({ type: "png" });
    const imageBuffer = new ArrayBuffer(image.byteLength);
    new Uint8Array(imageBuffer).set(image);
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });

    return new NextResponse(imageBlob, {
      headers: {
        "Content-Disposition": `attachment; filename="${appointment.bookingCode}.png"`,
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await browser.close();
  }
}

function buildReceiptHtml({
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
  location: {
    name: string;
    addressLine1: string;
    locality: string;
    city: string;
    state: string;
    postalCode: string;
  };
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

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(bookingCode)} Receipt</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; background: #eef5ff; color: #172033; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
      body { padding: 32px; }
      .receipt { width: 820px; overflow: hidden; border: 1px solid #cdddf2; border-radius: 8px; background: #ffffff; box-shadow: 0 24px 70px rgba(15, 23, 42, 0.16); }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; padding: 34px 38px; background: linear-gradient(135deg, #eff6ff 0%, #eff6ff 58%, #eff6ff 100%); border-bottom: 1px solid #dbeafe; }
      .brand { display: flex; min-width: 0; align-items: center; gap: 18px; }
      .brand-mark { display: flex; width: 60px; height: 60px; flex: 0 0 auto; align-items: center; justify-content: center; border-radius: 8px; background: #1d4ed8; color: #ffffff; box-shadow: 0 14px 26px rgba(29, 78, 216, 0.25); }
      .eyebrow { margin: 0; color: #1d4ed8; font-size: 13px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; }
      h1 { margin: 6px 0 0; color: #172033; font-size: 31px; font-weight: 850; line-height: 1.12; letter-spacing: 0; }
      .status { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #bbf7d0; border-radius: 999px; background: #f0fdf4; color: #166534; padding: 9px 15px; font-size: 13px; font-weight: 850; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
      .status-dot { width: 8px; height: 8px; border-radius: 999px; background: #16a34a; }
      .body { display: grid; gap: 22px; padding: 30px 38px 36px; }
      .hero { display: grid; grid-template-columns: 188px minmax(0, 1fr); gap: 24px; align-items: center; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; padding: 22px; }
      .qr-shell { display: flex; width: 168px; height: 168px; align-items: center; justify-content: center; border: 1px solid #dbeafe; border-radius: 8px; background: #ffffff; padding: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      .qr-shell img { width: 100%; height: 100%; object-fit: contain; display: block; }
      .slot-label { margin: 0; color: #64748b; font-size: 12px; font-weight: 850; letter-spacing: 0.14em; text-transform: uppercase; }
      .slot { margin: 8px 0 0; color: #0f172a; font-size: 30px; font-weight: 850; line-height: 1.18; letter-spacing: 0; }
      .reference { margin: 14px 0 0; color: #475569; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 14px; font-weight: 800; overflow-wrap: anywhere; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .detail { min-width: 0; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff; padding: 14px 16px; }
      .detail-label { margin: 0; color: #64748b; font-size: 11px; font-weight: 850; letter-spacing: 0.13em; text-transform: uppercase; }
      .detail-value { margin: 5px 0 0; color: #172033; font-size: 16px; font-weight: 800; line-height: 1.38; overflow-wrap: anywhere; }
      .instructions { border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; padding: 18px; }
      .instructions-title { display: flex; align-items: center; gap: 9px; margin: 0; color: #172033; font-size: 16px; font-weight: 850; }
      .shield { display: flex; width: 26px; height: 26px; align-items: center; justify-content: center; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 16px; }
      .steps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
      .step { display: flex; align-items: flex-start; gap: 9px; border-radius: 8px; background: #ffffff; padding: 11px 12px; color: #475569; font-size: 13px; font-weight: 750; line-height: 1.45; }
      .check { color: #1d4ed8; font-weight: 900; }
      .footer { display: flex; justify-content: space-between; gap: 18px; border-top: 1px solid #e2e8f0; padding-top: 18px; color: #64748b; font-size: 12px; font-weight: 700; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main id="receipt" class="receipt">
      <section class="header">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
              <path d="M3.22 12H9.5l.9-2.7 2.1 6.4 1.3-3.7h6.98" />
            </svg>
          </div>
          <div>
            <p class="eyebrow">CityCare Practitioner Network</p>
            <h1>OPD Appointment Receipt</h1>
          </div>
        </div>
      </section>

      <section class="body">
        <div class="hero">
          <div class="qr-shell">
            <img src="${qrImage}" alt="Booking QR code" />
          </div>
          <div>
            <p class="slot-label">Appointment time</p>
            <p class="slot">${escapeHtml(formatDateTime(slot))}</p>
            <p class="reference">Ref: ${escapeHtml(bookingCode)}</p>
          </div>
        </div>

        <div class="grid">
          ${details
            .map(
              ([label, value]) => `<div class="detail">
            <p class="detail-label">${escapeHtml(label)}</p>
            <p class="detail-value">${escapeHtml(value)}</p>
          </div>`,
            )
            .join("")}
        </div>

        <div class="instructions">
          <p class="instructions-title"><span class="shield">+</span> Reception instructions</p>
          <div class="steps">
            ${["Show this receipt at reception.", "Carry a valid ID.", "Arrive 10 minutes early.", "Keep the QR/reference code visible."]
              .map((step) => `<div class="step"><span class="check">&#10003;</span><span>${escapeHtml(step)}</span></div>`)
              .join("")}
          </div>
        </div>

        <div class="footer">
          <span>No cash collected in this booking flow unless shown separately at hospital billing.</span>
          <span>Generated securely by CityCare Practitioner Network.</span>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatAddress(location: {
  addressLine1: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
}) {
  return [location.addressLine1, location.locality, location.city, location.state, location.postalCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
