import { z } from "zod";
export const emailSchema = z.string().trim().email();
export const passwordSchema = z.string().min(8).max(128);
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const registerSchema = loginSchema;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
