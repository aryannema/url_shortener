import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";
import { cleanDB } from "./setup.js";

beforeEach(async () => {
  await cleanDB();
});

describe("POST /user/signup", () => {
  it("creates a user and returns 201 with userId", async () => {
    const res = await request(app).post("/user/signup").send({
      firstName: "Aryan",
      lastName: "Nema",
      email: "aryan@example.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBeDefined();
  });

  it("returns 400 when email already exists", async () => {
    const body = {
      firstName: "Aryan",
      email: "aryan@example.com",
      password: "password123",
    };

    await request(app).post("/user/signup").send(body);
    const res = await request(app).post("/user/signup").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("User with email already exists");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/user/signup").send({
      email: "aryan@example.com",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /user/login", () => {
  beforeEach(async () => {
    await request(app).post("/user/signup").send({
      firstName: "Aryan",
      email: "aryan@example.com",
      password: "password123",
    });
  });

  it("returns a token on successful login", async () => {
    const res = await request(app).post("/user/login").send({
      email: "aryan@example.com",
      password: "password123",
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe("string");
  });

  it("returns 400 for wrong password", async () => {
    const res = await request(app).post("/user/login").send({
      email: "aryan@example.com",
      password: "wrongpassword",
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent email", async () => {
    const res = await request(app).post("/user/login").send({
      email: "ghost@example.com",
      password: "password123",
    });

    expect(res.status).toBe(404);
  });
});
