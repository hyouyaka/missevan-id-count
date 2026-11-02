import assert from "node:assert/strict";
import test from "node:test";

test("platform preferences restore independently, notify live changes and survive blocked storage", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let saved = JSON.stringify({ missevan: 5, manbo: 2.55 });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => saved,
    setItem: (_key, value) => { saved = value; },
  } });
  try {
    const store = await import("./paidCoefficientStore.js?restore-test");
    assert.equal(store.getPaidCoefficient("missevan"), 5);
    assert.equal(store.getPaidCoefficient("manbo"), 1);
    let notifications = 0;
    const unsubscribe = store.subscribePaidCoefficient(() => notifications++);
    store.setPaidCoefficient("manbo", 17.6);
    assert.equal(notifications, 1);
    assert.equal(store.getPaidCoefficient("missevan"), 5);
    store.persistPaidCoefficients();
    assert.deepEqual(JSON.parse(saved), { missevan: 5, manbo: 17.6 });
    const reloaded = await import("./paidCoefficientStore.js?reload-test");
    assert.equal(reloaded.getPaidCoefficient("manbo"), 17.6);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    store.setPaidCoefficient("missevan", 3);
    assert.doesNotThrow(() => store.persistPaidCoefficients());
    assert.equal(store.getPaidCoefficient("missevan"), 3);
    unsubscribe();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
