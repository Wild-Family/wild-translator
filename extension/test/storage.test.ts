import { describe, expect, it, vi, beforeEach } from "vitest";
import { storage } from "../src/storage";

// Minimal chrome.storage mock
const syncStore: Record<string, any> = {};

beforeEach(() => {
  for (const k of Object.keys(syncStore)) delete syncStore[k];
});

(globalThis as any).chrome = {
  storage: {
    sync: {
      get: vi.fn(async (keys: string[]) => {
        const out: any = {};
        for (const k of keys) out[k] = syncStore[k];
        return out;
      }),
      set: vi.fn(async (obj: any) => {
        Object.assign(syncStore, obj);
      })
    }
  }
};

describe("storage", () => {
  it("getAll returns defaults when empty", async () => {
    const s = await storage.getAll();
    expect(s.prompts.length).toBeGreaterThan(0);
    expect(s.defaultPromptId).toBeTruthy();
  });

  it("setAll persists values", async () => {
    await storage.setAll({ defaultPromptId: "x" });
    const s = await storage.getAll();
    expect(s.defaultPromptId).toBe("x");
  });
});
