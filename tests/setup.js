import { db } from "../db/index.js";
import { clicksTable, urlsTable, usersTable } from "../models/index.js";

export async function cleanDB() {
  await db.delete(clicksTable);
  await db.delete(urlsTable);
  await db.delete(usersTable);
}
