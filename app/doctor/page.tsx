"use client";

import { ArrowRight, Loader2, LockKeyhole, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DoctorLoginOption = {
  id: string;
  name: string;
  specialty: string;
  department: string;
};

export default function DoctorPage() {
  const router = useRouter();
  const [doctors, setDoctors] = useState<DoctorLoginOption[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDoctors() {
      try {
        const response = await fetch("/api/doctor-login");
        const body = (await response.json()) as { doctors?: DoctorLoginOption[] };

        if (!mounted) return;
        const nextDoctors = body.doctors ?? [];
        setDoctors(nextDoctors);
        setDoctorId(nextDoctors[0]?.id ?? "");
      } catch {
        if (mounted) setMessage("Could not load doctors. Check database seed and refresh.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadDoctors();

    return () => {
      mounted = false;
    };
  }, []);

  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => doctor.id === doctorId),
    [doctorId, doctors],
  );

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doctorId || !accessCode.trim() || submitting) return;

    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/doctor-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, accessCode }),
      });
      const body = (await response.json()) as { message?: string; destination?: string };

      if (!response.ok || !body.destination) {
        setMessage(body.message ?? "Could not sign in.");
        return;
      }

      router.replace(body.destination);
    } catch {
      setMessage("Could not reach the doctor login service.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f9fc] px-4 py-8">
      <section className="w-full max-w-[440px] rounded-[18px] border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-primary text-primary-foreground">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">Doctor sign in</h1>
            <p className="mt-0.5 text-sm text-slate-500">Open your OPD workspace</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={submitLogin}>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Doctor</span>
            <select
              className="h-11 w-full rounded-[13px] border bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              disabled={loading || submitting}
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
            >
              {loading ? <option>Loading doctors</option> : null}
              {!loading && !doctors.length ? <option>No doctors found</option> : null}
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name} - {doctor.department}
                </option>
              ))}
            </select>
          </label>

          {selectedDoctor ? (
            <div className="rounded-[14px] border bg-[#f8fafc] px-3 py-2.5">
              <p className="truncate text-sm font-bold text-slate-800">{selectedDoctor.name}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                {selectedDoctor.specialty} - {selectedDoctor.department}
              </p>
            </div>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Access code</span>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                autoComplete="current-password"
                className="pl-9"
                disabled={loading || submitting || !doctors.length}
                onChange={(event) => setAccessCode(event.target.value)}
                type="password"
                value={accessCode}
              />
            </div>
          </label>

          {message ? (
            <div className="rounded-[13px] border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {message}
            </div>
          ) : null}

          <Button
            className="w-full rounded-[13px]"
            disabled={loading || submitting || !doctorId || !accessCode.trim()}
            type="submit"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Continue
          </Button>
        </form>
      </section>
    </main>
  );
}
