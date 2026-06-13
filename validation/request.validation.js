import { email, z } from "zod";

export const signupPostRequestBodySchema = z.object({
  firsname: z.string(),
  lastname: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(3),
});

export const loginPostRequestBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(3),
});

export const shortenPostRequestBodySchema = z.object({
  url: z.string().url(),
  code: z.string().optional(),
});

export const updateURLRequestBodySchema = z
  .object({
    url: z.string().url().optional(),
    code: z.string().optional(),
  })
  .refine((data) => data.url !== undefined || data.code !== undefined, {
    message: "At least one of url or code must be provided",
  });
