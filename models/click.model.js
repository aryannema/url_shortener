import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { urlsTable } from "./url.model.js";

export const clicksTable = pgTable("clicks", {
  id: uuid().primaryKey().defaultRandom(),

  urlId: uuid("url_id")
    .references(() => urlsTable.id, { onDelete: "cascade" })
    .notNull(),

  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 45 }),

  clickedAt: timestamp("clicked_at").defaultNow().notNull(),
});
