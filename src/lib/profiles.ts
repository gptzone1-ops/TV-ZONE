import type { ServiceType } from "../types";

export const LEGACY_PROFILE_CODES: Record<string, string> = {
  A: "2001",
  B: "2002",
  C: "2003",
  D: "2004",
  E: "2005",
};

export const PROFILE_CODES: Record<string, string> = {
  A: "8279",
  B: "3971",
  C: "9213",
  D: "9158",
  E: "0914",
};

export const PROFILE_NAMES = Object.keys(PROFILE_CODES);
export const SHAHID_PROFILE_NAMES = ["A", "B", "C", "D"];

export function generateShortId(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function buildProfileSlots(accountType: "private" | "shared", serviceType: ServiceType = "netflix") {
  const repeats = accountType === "private" ? 1 : 2;
  const profileNames = serviceType === "shahid" ? SHAHID_PROFILE_NAMES : PROFILE_NAMES;

  return profileNames.flatMap((profileName) =>
    Array.from({ length: repeats }, (_, index) => ({
      profile_name: accountType === "private" ? profileName : `${profileName}${index + 1}`,
      profile_label: profileName,
      profile_code: serviceType === "shahid" ? "" : PROFILE_CODES[profileName],
      service_type: serviceType,
      uuid: crypto.randomUUID(),
      short_id: generateShortId(),
    })),
  );
}

export function accountTypeLabel(type: "private" | "shared") {
  return type === "private" ? "خاص" : "مشترك";
}
