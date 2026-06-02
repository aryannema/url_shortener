import { z } from "zod";

export const signupPostRequestBodySchema = z.object({
  firsname: z.string(),
  lastname: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(3),
});
