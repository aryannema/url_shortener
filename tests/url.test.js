import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";
import { cleanDB } from "./setup.js";
import { createUserAndLogin, createShortURL } from "./helpers.js";

beforeEach(async () => {
  await cleanDB();
});

describe("POST /shorten", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(401);
  });

  it("creates a short URL and returns it", async () => {
    const token = await createUserAndLogin("a@example.com");
    const res = await request(app)
      .post("/shorten")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://example.com" });

    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBeDefined();
    expect(res.body.targetURL).toBe("https://example.com");
  });

  it("respects a custom code when provided", async () => {
    const token = await createUserAndLogin("a@example.com");
    const res = await request(app)
      .post("/shorten")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://example.com", code: "mycode" });

    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBe("mycode");
  });
});

describe("GET /codes", () => {
  it("returns only the authenticated user's URLs", async () => {
    const tokenA = await createUserAndLogin("a@example.com");
    const tokenB = await createUserAndLogin("b@example.com");

    await createShortURL(tokenA, "https://a.com");
    await createShortURL(tokenA, "https://b.com");
    await createShortURL(tokenB, "https://c.com");

    const res = await request(app)
      .get("/codes")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.codes).toHaveLength(2);
  });
});

describe("PATCH /:id", () => {
  it("updates the target URL", async () => {
    const token = await createUserAndLogin("a@example.com");
    const { id } = await createShortURL(token, "https://old.com");

    const res = await request(app)
      .patch(`/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://new.com" });

    expect(res.status).toBe(200);
    expect(res.body.targetURL).toBe("https://new.com");
  });

  it("returns 404 when trying to update another user's URL", async () => {
    const tokenA = await createUserAndLogin("a@example.com");
    const tokenB = await createUserAndLogin("b@example.com");
    const { id } = await createShortURL(tokenA, "https://a.com");

    const res = await request(app)
      .patch(`/${id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ url: "https://hacked.com" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when no fields are provided", async () => {
    const token = await createUserAndLogin("a@example.com");
    const { id } = await createShortURL(token, "https://example.com");

    const res = await request(app)
      .patch(`/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("DELETE /:id", () => {
  it("deletes the URL for the owner", async () => {
    const token = await createUserAndLogin("a@example.com");
    const { id } = await createShortURL(token, "https://example.com");

    const res = await request(app)
      .delete(`/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it("does not delete another user's URL", async () => {
    const tokenA = await createUserAndLogin("a@example.com");
    const tokenB = await createUserAndLogin("b@example.com");
    const { id } = await createShortURL(tokenA, "https://a.com");

    await request(app)
      .delete(`/${id}`)
      .set("Authorization", `Bearer ${tokenB}`);

    const codesRes = await request(app)
      .get("/codes")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(codesRes.body.codes).toHaveLength(1);
  });
});

describe("GET /:shortCode (redirect)", () => {
  it("redirects to the target URL", async () => {
    const token = await createUserAndLogin("a@example.com");
    await createShortURL(token, "https://example.com", "testcode");

    const res = await request(app).get("/testcode");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com");
  });

  it("returns 404 for an unknown short code", async () => {
    const res = await request(app).get("/doesnotexist");
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/stats", () => {
  it("returns click count after redirects", async () => {
    const token = await createUserAndLogin("a@example.com");
    const { id, shortCode } = await createShortURL(token, "https://example.com");

    await request(app).get(`/${shortCode}`);
    await request(app).get(`/${shortCode}`);

    const res = await request(app)
      .get(`/${id}/stats`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalClicks).toBe(2);
    expect(res.body.clicks).toHaveLength(2);
  });

  it("returns 404 for another user's URL stats", async () => {
    const tokenA = await createUserAndLogin("a@example.com");
    const tokenB = await createUserAndLogin("b@example.com");
    const { id } = await createShortURL(tokenA, "https://a.com");

    const res = await request(app)
      .get(`/${id}/stats`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });
});
