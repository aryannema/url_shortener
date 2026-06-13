import express from "express";
import {
  shortenPostRequestBodySchema,
  updateURLRequestBodySchema,
} from "../validation/request.validation.js";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { urlsTable, clicksTable } from "../models/index.js";
import { ensureAuthenticated } from "../middlewares/auth.middleware.js";
import { shortenRateLimit } from "../middlewares/rate-limit.middleware.js";
import { and, eq } from "drizzle-orm";

const router = express.Router();

router.post("/shorten", ensureAuthenticated, shortenRateLimit, async function (req, res) {
  const validationResult = await shortenPostRequestBodySchema.safeParseAsync(
    req.body,
  );

  if (validationResult.error)
    return res.status(400).json({ error: validationResult.error });

  const { url, code } = validationResult.data;

  const shortCode = code ?? nanoid(6);

  const [result] = await db
    .insert(urlsTable)
    .values({
      shortCode: shortCode,
      targetURL: url,
      userId: req.user.id,
    })
    .returning({
      id: urlsTable.id,
      shortCode: urlsTable.shortCode,
      targetURL: urlsTable.targetURL,
    });

  return res.status(201).json({
    id: result.id,
    shortCode: result.shortCode,
    targetURL: result.targetURL,
  });
});

router.get("/codes", ensureAuthenticated, async function (req, res) {
  const codes = await db
    .select()
    .from(urlsTable)
    .where(eq(urlsTable.userId, req.user.id));

  return res.json({ codes });
});

router.delete("/:id", ensureAuthenticated, async function (req, res) {
  const id = req.params.id;
  const result = await db
    .delete(urlsTable)
    .where(and(eq(urlsTable.id, id), eq(urlsTable.userId, req.user.id)));

  return res.status(200).json({ deleted: true });
});

router.patch("/:id", ensureAuthenticated, async function (req, res) {
  const validationResult = await updateURLRequestBodySchema.safeParseAsync(
    req.body,
  );

  if (validationResult.error)
    return res.status(400).json({ error: validationResult.error.format() });

  const { url, code } = validationResult.data;

  const [updated] = await db
    .update(urlsTable)
    .set({
      ...(url && { targetURL: url }),
      ...(code && { shortCode: code }),
    })
    .where(and(eq(urlsTable.id, req.params.id), eq(urlsTable.userId, req.user.id)))
    .returning({
      id: urlsTable.id,
      shortCode: urlsTable.shortCode,
      targetURL: urlsTable.targetURL,
    });

  if (!updated)
    return res.status(404).json({ error: "URL not found or not owned by you" });

  return res.json(updated);
});

router.get("/:id/stats", ensureAuthenticated, async function (req, res) {
  const [url] = await db
    .select({ id: urlsTable.id })
    .from(urlsTable)
    .where(and(eq(urlsTable.id, req.params.id), eq(urlsTable.userId, req.user.id)));

  if (!url)
    return res.status(404).json({ error: "URL not found or not owned by you" });

  const clicks = await db
    .select({
      clickedAt: clicksTable.clickedAt,
      userAgent: clicksTable.userAgent,
      ipAddress: clicksTable.ipAddress,
    })
    .from(clicksTable)
    .where(eq(clicksTable.urlId, req.params.id));

  return res.json({ totalClicks: clicks.length, clicks });
});

router.get("/:shortCode", async function (req, res) {
  const code = req.params.shortCode;
  const [result] = await db
    .select({
      id: urlsTable.id,
      targetURL: urlsTable.targetURL,
    })
    .from(urlsTable)
    .where(eq(urlsTable.shortCode, code));

  if (!result) {
    return res.status(404).json({ error: "Invalid url" });
  }

  await db.insert(clicksTable).values({
    urlId: result.id,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
  });

  return res.redirect(result.targetURL);
});

export default router;
