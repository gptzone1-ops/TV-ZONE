import type { ServiceType } from "../types";

export const PROFILE_CODES: Record<string, string> = {
  A: "1212",
  B: "2323",
  C: "3434",
  D: "4545",
  E: "5656",
};

export const PROFILE_NAMES = Object.keys(PROFILE_CODES);
export const SHAHID_PROFILE_NAMES = ["A", "B", "C", "D"];

export function generateShortId(length = 6) {
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
      short_id: generateShortId(6),
      otp_status: "not_requested" as const,
    })),
  );
}

export function accountTypeLabel(type: "private" | "shared") {
  return type === "private" ? "خاص" : "مشترك";
}
