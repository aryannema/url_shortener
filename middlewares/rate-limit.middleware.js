import { rateLimit } from "express-rate-limit";

const skip = () => process.env.NODE_ENV === "test";

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip,
  message: { error: "Too many attempts, please try again after 15 minutes" },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

export const shortenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  skip,
  message: { error: "Too many URLs created, please slow down" },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
