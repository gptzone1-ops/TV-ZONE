import type { ServiceType } from "../types";

export const LEGACY_PROFILE_CODES: Record<string, string> = {
  A: "2001",
  B: "2002",
  C: "2003",
  D: "2004",
  E: "2005",
};

export const PREVIOUS_PROFILE_CODES: Record<string, string> = {
  A: "8279",
  B: "3971",
  C: "9213",
  D: "9158",
  E: "0914",
};

// Used only when creating new customer links. Existing rows keep their stored PINs.
export const PROFILE_CODES: Record<string, string> = {
  A: "8888",
  B: "9000",
  C: "1234",
  D: "6666",
  E: "5556",
};

export const PROFILE_NAMES = Object.keys(PROFILE_CODES);
export const SHAHID_PROFILE_NAMES = ["A", "B", "C", "D"];

// Applied only while creating new shared Netflix accounts. Existing links are never rewritten.
export const NEW_SHARED_NETFLIX_PROFILE_CAPACITY: Record<string, number> = {
  A: 0,
  B: 2,
  C: 2,
  D: 2,
  E: 2,
};

export function generateShortId(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function generateUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildProfileSlots(accountType: "private" | "shared", serviceType: ServiceType = "netflix") {
  if (accountType === "shared" && serviceType === "netflix") {
    return Object.entries(NEW_SHARED_NETFLIX_PROFILE_CAPACITY).flatMap(([profileName, capacity]) =>
      Array.from({ length: capacity }, (_, index) => ({
        profile_name: `${profileName}${index + 1}`,
        profile_label: profileName,
        profile_code: PROFILE_CODES[profileName],
        service_type: serviceType,
        uuid: generateUuid(),
        short_id: generateShortId(),
      })),
    );
  }

  const repeats = accountType === "private" ? 1 : 2;
  const profileNames = serviceType === "shahid" ? SHAHID_PROFILE_NAMES : PROFILE_NAMES;

  return profileNames.flatMap((profileName) =>
    Array.from({ length: repeats }, (_, index) => ({
      profile_name: accountType === "private" ? profileName : `${profileName}${index + 1}`,
      profile_label: profileName,
      profile_code: serviceType === "shahid" ? "" : PROFILE_CODES[profileName],
      service_type: serviceType,
      uuid: generateUuid(),
      short_id: generateShortId(),
    })),
  );
}

export function accountTypeLabel(type: "private" | "shared") {
  return type === "private" ? "خاص" : "مشترك";
}
