import type { AccountType, CompensationDistribution, ServiceType } from "../types";

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

export const FORMER_PROFILE_CODES: Record<string, string> = {
  A: "8888",
  B: "9000",
  C: "1234",
  D: "6666",
  E: "5556",
};

// Used only when creating new customer links. Existing rows keep their stored PINs.
export const PROFILE_CODES: Record<string, string> = {
  A: "3333",
  B: "3334",
  C: "9999",
  D: "1212",
  E: "9090",
};

export const PROFILE_NAMES = Object.keys(PROFILE_CODES);
export const SHAHID_PROFILE_NAMES = ["A", "B", "C", "D"];

const SHARED_COMPENSATION_PROFILES = ["B", "C", "D", "E"] as const;

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

function createNetflixSlot(profileName: string, profileLabel: string) {
  return {
    profile_name: profileName,
    profile_label: profileLabel,
    profile_code: PROFILE_CODES[profileLabel],
    service_type: "netflix" as const,
    uuid: generateUuid(),
    short_id: generateShortId(),
  };
}

export function buildProfileSlots(
  accountType: AccountType,
  serviceType: ServiceType = "netflix",
  compensationDistribution: CompensationDistribution = "private",
) {
  if (accountType === "temporary") return [];

  if (accountType === "compensation") {
    if (compensationDistribution === "shared") {
      const sharedSlots = SHARED_COMPENSATION_PROFILES.flatMap((profileName) =>
        [1, 2].map((slotNumber) => ({
          profile_name: `${profileName}${slotNumber}`,
          profile_label: profileName,
          profile_code: PROFILE_CODES[profileName],
          service_type: "netflix" as const,
          uuid: generateUuid(),
          short_id: generateShortId(),
        })),
      );

      if (sharedSlots.length !== 8) throw new Error("invalid_shared_compensation_slots");
      return sharedSlots;
    }

    return PROFILE_NAMES.map((profileName) => ({
      profile_name: profileName,
      profile_label: profileName,
      profile_code: PROFILE_CODES[profileName],
      service_type: "netflix" as const,
      uuid: generateUuid(),
      short_id: generateShortId(),
    }));
  }

  if (accountType === "shared" && serviceType === "netflix") {
    // Deliberately explicit: new shared accounts always have exactly A1..E2.
    return [
      createNetflixSlot("A1", "A"),
      createNetflixSlot("A2", "A"),
      createNetflixSlot("B1", "B"),
      createNetflixSlot("B2", "B"),
      createNetflixSlot("C1", "C"),
      createNetflixSlot("C2", "C"),
      createNetflixSlot("D1", "D"),
      createNetflixSlot("D2", "D"),
      createNetflixSlot("E1", "E"),
      createNetflixSlot("E2", "E"),
    ];
  }

  if (accountType === "private" && serviceType === "netflix") {
    // Deliberately explicit: new private accounts always have exactly A..E.
    return [
      createNetflixSlot("A", "A"),
      createNetflixSlot("B", "B"),
      createNetflixSlot("C", "C"),
      createNetflixSlot("D", "D"),
      createNetflixSlot("E", "E"),
    ];
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

export function accountTypeLabel(type: AccountType) {
  if (type === "temporary") return "حساب مؤقت";
  if (type === "compensation") return "التعويضات";
  return type === "private" ? "خاص" : "مشترك";
}
