import request from "supertest";
import app from "../app.js";

export async function createUserAndLogin(email = "test@example.com") {
  await request(app).post("/user/signup").send({
    firstName: "Test",
    lastName: "User",
    email,
    password: "password123",
  });

  const res = await request(app).post("/user/login").send({
    email,
    password: "password123",
  });

  return res.body.token;
}

export async function createShortURL(token, url = "https://example.com", code) {
  const body = { url };
  if (code) body.code = code;

  const res = await request(app)
    .post("/shorten")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

  return res.body;
}
