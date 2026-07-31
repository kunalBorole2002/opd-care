import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hospital OPD Booking",
  description: "Modern OPD appointment booking for hospital patients.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
