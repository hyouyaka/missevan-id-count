import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  ImageProxyPolicyError,
  assertImageContentLength,
  detectImageContentType,
  readImageBodyWithLimit,
  validateImageProxyUrl,
} from "./imageProxyPolicy.js";

test("image policy detects supported image types from file signatures", () => {
  const fixtures = [
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ["image/gif", Buffer.from("GIF87a", "ascii")],
    ["image/gif", Buffer.from("GIF89a", "ascii")],
    ["image/webp", Buffer.from("RIFF1234WEBP", "ascii")],
    [
      "image/avif",
      Buffer.from([
        0x00, 0x00, 0x00, 0x18,
        0x66, 0x74, 0x79, 0x70,
        0x61, 0x76, 0x69, 0x66,
        0x00, 0x00, 0x00, 0x00,
        0x6d, 0x69, 0x66, 0x31,
        0x61, 0x76, 0x69, 0x66,
      ]),
    ],
  ];

  for (const [expectedType, bytes] of fixtures) {
    assert.equal(detectImageContentType(bytes), expectedType);
  }
});

test("image policy rejects truncated signatures and non-image bodies", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from([0xff, 0xd8]),
    Buffer.from("GIF89", "ascii"),
    Buffer.from("RIFF1234", "ascii"),
    Buffer.from("<html>not an image</html>", "utf8"),
  ]) {
    assert.equal(detectImageContentType(bytes), null);
  }
});

test("image policy detects the body type independently of an upstream content type", () => {
  const forceDownloadJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const mislabeledJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1]);

  assert.equal(detectImageContentType(forceDownloadJpeg), "image/jpeg");
  assert.equal(detectImageContentType(mislabeledJpeg), "image/jpeg");
});

test("image policy rejects declared lengths above the byte limit", () => {
  assert.throws(
    () => assertImageContentLength("11", 10),
    (error) =>
      error instanceof ImageProxyPolicyError &&
      error.status === 413 &&
      error.code === "IMAGE_TOO_LARGE"
  );
  assert.doesNotThrow(() => assertImageContentLength("", 10));
  assert.doesNotThrow(() => assertImageContentLength("10", 10));
});

test("image policy stops reading when streamed bytes exceed the limit", async () => {
  const body = Readable.from([Buffer.alloc(6), Buffer.alloc(5)]);
  await assert.rejects(
    readImageBodyWithLimit(body, 10),
    (error) =>
      error instanceof ImageProxyPolicyError &&
      error.status === 413 &&
      error.code === "IMAGE_TOO_LARGE"
  );
});

test("image policy returns a buffer when streamed bytes fit the limit", async () => {
  const body = Readable.from([Buffer.from("hello"), Buffer.from("world")]);
  const result = await readImageBodyWithLimit(body, 10);
  assert.equal(result.toString("utf8"), "helloworld");
});

test("image policy validates every redirect target against protocol and host rules", () => {
  const allowedHosts = new Set(["img.example.com"]);
  const validate = (value) =>
    validateImageProxyUrl(value, (hostname) => allowedHosts.has(hostname));

  assert.equal(validate("https://img.example.com/a.jpg").hostname, "img.example.com");
  assert.throws(
    () => validate("http://img.example.com/a.jpg"),
    (error) => error instanceof ImageProxyPolicyError && error.status === 400
  );
  assert.throws(
    () => validate("https://127.0.0.1/a.jpg"),
    (error) => error instanceof ImageProxyPolicyError && error.status === 400
  );
});
