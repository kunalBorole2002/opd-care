import { DoctorDashboard } from "@/components/doctor-dashboard";

export default async function DoctorWorkspacePage({
  params,
}: {
  params: Promise<{ doctorId: string }>;
}) {
  const { doctorId } = await params;
  return <DoctorDashboard doctorId={doctorId} />;
}
