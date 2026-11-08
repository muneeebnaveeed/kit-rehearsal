import { describe, expect, it } from "vitest";
import { isGuestId } from "../shared/guest.ts";
import { GUEST_ID_STORAGE_KEY, type GuestIdStorage, getGuestId } from "./guestId.ts";

function memoryStorage(initial: Record<string, string> = {}): GuestIdStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const throwing: GuestIdStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("getGuestId", () => {
  it("creates a UUID and stores it under kit:guestId", () => {
    const storage = memoryStorage();
    const id = getGuestId(storage);
    expect(isGuestId(id)).toBe(true);
    expect(GUEST_ID_STORAGE_KEY).toBe("kit:guestId");
    expect(storage.data.get("kit:guestId")).toBe(id);
  });

  it("reuses the stored ID, so every tab and every reload gets the same one", () => {
    const storage = memoryStorage();
    const first = getGuestId(storage);
    expect(getGuestId(storage)).toBe(first);
    const otherTab = memoryStorage({ [GUEST_ID_STORAGE_KEY]: first });
    expect(getGuestId(otherTab)).toBe(first);
  });

  it("replaces a stored value that isn't a guest ID", () => {
    const storage = memoryStorage({ [GUEST_ID_STORAGE_KEY]: "not-a-uuid" });
    const id = getGuestId(storage);
    expect(id).not.toBe("not-a-uuid");
    expect(isGuestId(id)).toBe(true);
    expect(storage.data.get(GUEST_ID_STORAGE_KEY)).toBe(id);
  });

  it("falls back to one in-memory ID per page when storage throws", () => {
    const id = getGuestId(throwing);
    expect(isGuestId(id)).toBe(true);
    expect(getGuestId(throwing)).toBe(id);
  });

  it("falls back to the in-memory ID when there is no storage, or only reading works", () => {
    const id = getGuestId(throwing);
    expect(getGuestId(null)).toBe(id);
    const readOnly: GuestIdStorage = { getItem: () => null, setItem: throwing.setItem };
    expect(getGuestId(readOnly)).toBe(id);
  });

  it("gives different browsers different IDs", () => {
    expect(getGuestId(memoryStorage())).not.toBe(getGuestId(memoryStorage()));
  });
});
