import { describe, expect, it, vi } from "vitest";

import {
  createPaystackCallbackUrl,
  listenForPaystackCallback,
  paymentCallbackFromUrl,
  resumePaystackPayment,
} from "../src/client";

const inline = vi.hoisted(() => ({
  accessCode: "",
  callbacks: null as null | {
    onSuccess: (transaction: {
      id: number;
      reference: string;
      message: string;
    }) => void;
    onCancel: () => void;
    onError: (error: { message: string }) => void;
  },
}));

vi.mock("@paystack/inline-js", () => ({
  default: class {
    resumeTransaction(
      accessCode: string,
      callbacks: NonNullable<typeof inline.callbacks>,
    ) {
      inline.accessCode = accessCode;
      inline.callbacks = callbacks;

      return { id: "popup" };
    }
  },
}));

const memoryStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe("Paystack browser client", () => {
  it("verifies InlineJS success in realtime", async () => {
    const verify = vi.fn().mockResolvedValue({ status: "paid" });
    const onVerified = vi.fn();

    await expect(
      resumePaystackPayment({
        accessCode: "access_code",
        verify,
        onVerified,
      }),
    ).resolves.toEqual({ id: "popup" });
    inline.callbacks?.onSuccess({
      id: 42,
      reference: "hof_reference",
      message: "Approved",
    });
    await vi.waitFor(() => expect(onVerified).toHaveBeenCalled());

    expect(inline.accessCode).toBe("access_code");
    expect(verify).toHaveBeenCalledWith("hof_reference");
    expect(onVerified).toHaveBeenCalledWith(
      { status: "paid" },
      "hof_reference",
    );
  });

  it("creates and recognizes a nonce-bound callback URL", () => {
    const storage = memoryStorage();
    const callbackUrl = createPaystackCallbackUrl(
      "https://app.example.com/account/billing?keep=value",
      storage,
    );
    const redirected = new URL(callbackUrl);
    redirected.searchParams.set("reference", "hof_reference");

    expect(
      paymentCallbackFromUrl(redirected.toString(), storage),
    ).toMatchObject({
      reference: "hof_reference",
    });
    expect(redirected.searchParams.get("keep")).toBe("value");
  });

  it("verifies a detected callback and removes payment query parameters", async () => {
    const storage = memoryStorage();
    const callbackUrl = createPaystackCallbackUrl(
      "https://app.example.com/account/billing",
      storage,
    );
    const redirected = new URL(callbackUrl);
    redirected.searchParams.set("reference", "hof_reference");
    const verify = vi.fn().mockResolvedValue({ status: "paid" });
    const replaceState = vi.fn();
    const onVerified = vi.fn();
    const listeners = new Map<string, EventListener>();
    const eventTarget = {
      addEventListener: (
        name: string,
        listener: EventListenerOrEventListenerObject,
      ) => listeners.set(name, listener as EventListener),
      removeEventListener: (name: string) => listeners.delete(name),
    };

    const stop = listenForPaystackCallback({
      verify,
      onVerified,
      currentUrl: () => redirected.toString(),
      eventTarget,
      history: { replaceState },
      storage,
    });
    await vi.waitFor(() => expect(onVerified).toHaveBeenCalled());

    expect(verify).toHaveBeenCalledWith("hof_reference");
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "https://app.example.com/account/billing",
    );
    stop();
    expect(listeners.size).toBe(0);
  });
});
