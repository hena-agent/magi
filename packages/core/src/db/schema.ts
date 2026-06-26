import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  workspaceRoot: text("workspace_root").notNull(),
  title: text("title"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessionEvents = sqliteTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_events_session_sequence_idx").on(table.sessionId, table.sequence),
    index("session_events_session_type_idx").on(table.sessionId, table.type),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionEventRow = typeof sessionEvents.$inferSelect;
