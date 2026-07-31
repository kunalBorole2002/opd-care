import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const doctors = [
  {
    id: "doctor_sameet_umate",
    name: "Dr. Sameet Umate",
    specialty: "Consultant Pediatrician & Neonatologist",
    department: "Pediatrics & Neonatology",
    experienceYears: 10,
    fee: 0,
  },
  {
    id: "doctor_shweta_lodhi_umate",
    name: "Dr. Shweta Lodhi Umate",
    specialty: "Consultant Obstetrician, Gynaecologist & General Practitioner",
    department: "Obstetrics & Gynaecology",
    experienceYears: 10,
    fee: 0,
  },
];

const locations = [
  {
    id: "location_medivin_manish_nagar",
    name: "Medivin Clinic",
    addressLine1: "",
    locality: "Manish Nagar",
    city: "Nagpur",
    state: "",
    postalCode: "",
  },
  {
    id: "location_raut_nagpur",
    name: "Raut Hospital",
    addressLine1: "",
    locality: "",
    city: "Nagpur",
    state: "",
    postalCode: "",
  },
  {
    id: "location_shridha_nagpur",
    name: "Shridha Hospital",
    addressLine1: "",
    locality: "",
    city: "Nagpur",
    state: "",
    postalCode: "",
  },
];

const sessionLocations = [
  ["dsl_sameet_medivin_afternoon", "doctor_sameet_umate", "location_medivin_manish_nagar", "AFTERNOON"],
  ["dsl_sameet_medivin_evening", "doctor_sameet_umate", "location_medivin_manish_nagar", "EVENING"],
  ["dsl_sameet_shridha_morning", "doctor_sameet_umate", "location_shridha_nagpur", "MORNING"],
  ["dsl_shweta_medivin_afternoon", "doctor_shweta_lodhi_umate", "location_medivin_manish_nagar", "AFTERNOON"],
  ["dsl_shweta_medivin_evening", "doctor_shweta_lodhi_umate", "location_medivin_manish_nagar", "EVENING"],
  ["dsl_shweta_raut_morning", "doctor_shweta_lodhi_umate", "location_raut_nagpur", "MORNING"],
].map(([id, doctorId, locationId, session]) => ({ id, doctorId, locationId, session }));

async function main() {
  await prisma.$transaction(async (tx) => {
    for (const doctor of doctors) {
      await tx.doctor.upsert({ where: { id: doctor.id }, update: doctor, create: doctor });
    }

    for (const location of locations) {
      await tx.location.upsert({ where: { id: location.id }, update: location, create: location });
    }

    for (const sessionLocation of sessionLocations) {
      await tx.doctorSessionLocation.upsert({
        where: { id: sessionLocation.id },
        update: sessionLocation,
        create: sessionLocation,
      });
    }
  });
}

main()
  .then(() => console.log("Seeded 2 doctors, 3 locations, and 6 doctor session locations."))
  .finally(async () => prisma.$disconnect());
