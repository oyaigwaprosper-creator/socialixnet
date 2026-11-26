import { pgTable, text, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

// Members of the network. Each browser gets an anonymous account backed by a
// random session token (only its SHA-256 hash is stored).
export const users = pgTable("users", {
  id: text().primaryKey(),
  sessionHash: text("session_hash").unique(),
  displayName: text("display_name").notNull(),
  handle: text().notNull(),
  bio: text().notNull().default(""),
  avatarColor: text("avatar_color").notNull().default("bg-indigo-600"),
  avatarEmoji: text("avatar_emoji").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable(
  "posts",
  {
    id: text().primaryKey(),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    content: text().notNull().default(""),
    tag: text().notNull().default("General"),
    imageUrl: text("image_url").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_created_at_idx").on(t.createdAt)],
);

export const likes = pgTable(
  "likes",
  {
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: text().primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    text: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_post_id_idx").on(t.postId)],
);

export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followeeId: text("followee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] })],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);
