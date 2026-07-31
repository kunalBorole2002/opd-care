export const DOCTOR_SESSION_COOKIE = "hospital_doctor_id";
export const DOCTOR_ACCESS_CODE = "123456789";

export function isDoctorAccessCodeValid(value: string | undefined) {
  return value?.trim().toUpperCase() === DOCTOR_ACCESS_CODE;
}
