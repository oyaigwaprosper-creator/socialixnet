import type { Config, Context } from "@netlify/server";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { bookmarks, comments, follows, likes, posts, users } from "../../db/schema.ts";

export const config: Config = { path: "/api/*" };

const SESSION_COOKIE = "pulse_session";
const ONE_YEAR = 60 * 60 * 24 * 365;
const DEFAULT_FOLLOWING = ["creator_maya", "creator_devon"];
const FEED_LIMIT = 200;
const CREATOR_LIMIT = 50;

const MAX_POST = 500;
const MAX_COMMENT = 280;
const MAX_NAME = 50;
const MAX_HANDLE = 30;
const MAX_BIO = 160;
const MAX_TAG = 30;
const MAX_URL = 1000;
const MAX_EMOJI = 16;

type User = typeof users.$inferSelect;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- helpers ----------

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function cleanHandle(value: unknown): string {
  return str(value, 100).replace(/[^a-zA-Z0-9_]/g, "").toLowerCase().slice(0, MAX_HANDLE);
}

function cleanColor(value: unknown): string {
  return typeof value === "string" && /^bg-[a-z]+-\d{3}$/.test(value) ? value : "bg-indigo-600";
}

function cleanTag(value: unknown): string {
  const tag = str(value, 100).replace(/[^a-zA-Z0-9_]/g, "").slice(0, MAX_TAG);
  return tag || "General";
}

function cleanImageUrl(value: unknown): string {
  const raw = str(value, MAX_URL);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new HttpError(400, "Image link must be a valid http(s) URL");
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toCreator(u: Pick<User, "id" | "displayName" | "handle" | "bio" | "avatarColor" | "avatarEmoji">) {
  return {
    uid: u.id,
    displayName: u.displayName,
    handle: u.handle,
    bio: u.bio,
    avatarColor: u.avatarColor,
    avatarEmoji: u.avatarEmoji,
  };
}

// ---------- sessions ----------

async function findUser(context: Context): Promise<User | null> {
  const token = context.cookies.get(SESSION_COOKIE);
  if (!token) return null;
  const [user] = await db.select().from(users).where(eq(users.sessionHash, hashToken(token))).limit(1);
  return user ?? null;
}

async function requireUser(context: Context): Promise<User> {
  const user = await findUser(context);
  if (!user) throw new HttpError(401, "Session expired. Refresh the page to continue.");
  return user;
}

async function createUser(context: Context): Promise<User> {
  const token = randomBytes(32).toString("base64url");
  const id = newId("u");
  const shortTag = id.slice(2, 7).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const [user] = await db
    .insert(users)
    .values({
      id,
      sessionHash: hashToken(token),
      displayName: `Creator ${shortTag.toUpperCase()}`,
      handle: `creator_${shortTag}`,
      bio: "Sharing ideas, building projects, and exploring Pulse.",
      avatarColor: "bg-indigo-600",
      avatarEmoji: "🚀",
    })
    .returning();

  const starters = await db.select({ id: users.id }).from(users).where(inArray(users.id, DEFAULT_FOLLOWING));
  if (starters.length) {
    await db
      .insert(follows)
      .values(starters.map((s) => ({ followerId: id, followeeId: s.id })))
      .onConflictDoNothing();
  }

  context.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: ONE_YEAR,
  });
  return user;
}

async function profileFor(user: User) {
  const [following, saved] = await Promise.all([
    db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id)),
    db.select({ id: bookmarks.postId }).from(bookmarks).where(eq(bookmarks.userId, user.id)),
  ]);
  return {
    ...toCreator(user),
    following: following.map((f) => f.id),
    bookmarks: saved.map((b) => b.id),
  };
}

// ---------- feed ----------

async function loadFeed() {
  const postRows = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .orderBy(desc(posts.createdAt))
    .limit(FEED_LIMIT);

  const postIds = postRows.map((r) => r.post.id);

  const [likeRows, commentRows, creatorRows] = await Promise.all([
    postIds.length
      ? db.select({ postId: likes.postId, userId: likes.userId }).from(likes).where(inArray(likes.postId, postIds))
      : Promise.resolve([]),
    postIds.length
      ? db
          .select({ comment: comments, author: users })
          .from(comments)
          .innerJoin(users, eq(comments.authorId, users.id))
          .where(inArray(comments.postId, postIds))
          .orderBy(asc(comments.createdAt))
      : Promise.resolve([]),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        handle: users.handle,
        bio: users.bio,
        avatarColor: users.avatarColor,
        avatarEmoji: users.avatarEmoji,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(CREATOR_LIMIT),
  ]);

  const likesByPost = new Map<string, string[]>();
  for (const l of likeRows) {
    if (!likesByPost.has(l.postId)) likesByPost.set(l.postId, []);
    likesByPost.get(l.postId)!.push(l.userId);
  }

  const commentsByPost = new Map<string, unknown[]>();
  for (const { comment, author } of commentRows) {
    if (!commentsByPost.has(comment.postId)) commentsByPost.set(comment.postId, []);
    commentsByPost.get(comment.postId)!.push({
      id: comment.id,
      authorId: author.id,
      authorName: author.displayName,
      authorHandle: author.handle,
      authorColor: author.avatarColor,
      authorEmoji: author.avatarEmoji,
      text: comment.text,
      createdAt: comment.createdAt.getTime(),
    });
  }

  return {
    posts: postRows.map(({ post, author }) => ({
      id: post.id,
      authorId: author.id,
      authorName: author.displayName,
      authorHandle: author.handle,
      authorColor: author.avatarColor,
      authorEmoji: author.avatarEmoji,
      content: post.content,
      tag: post.tag,
      imageUrl: post.imageUrl,
      likes: likesByPost.get(post.id) ?? [],
      comments: commentsByPost.get(post.id) ?? [],
      createdAt: post.createdAt.getTime(),
    })),
    creators: creatorRows.map(toCreator),
  };
}

async function postExists(postId: string) {
  const [row] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!row) throw new HttpError(404, "That post no longer exists");
}

// ---------- router ----------

async function route(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = req.method.toUpperCase();
  const [resource, id, action] = parts;

  // Session / profile
  if (resource === "me" && parts.length === 1) {
    if (method === "GET") {
      const user = (await findUser(context)) ?? (await createUser(context));
      return json(await profileFor(user));
    }
    if (method === "PUT") {
      const user = await requireUser(context);
      const body = await readBody(req);
      const displayName = str(body.displayName, MAX_NAME);
      const handle = cleanHandle(body.handle);
      if (!displayName || !handle) throw new HttpError(400, "Please enter a valid display name and handle");
      const [updated] = await db
        .update(users)
        .set({
          displayName,
          handle,
          bio: str(body.bio, MAX_BIO),
          avatarColor: cleanColor(body.avatarColor),
          avatarEmoji: str(body.avatarEmoji, MAX_EMOJI),
        })
        .where(eq(users.id, user.id))
        .returning();
      return json(await profileFor(updated));
    }
  }

  // Public feed
  if (resource === "feed" && parts.length === 1 && method === "GET") {
    return json(await loadFeed());
  }

  // Posts
  if (resource === "posts") {
    if (!id && method === "POST") {
      const user = await requireUser(context);
      const body = await readBody(req);
      const content = str(body.content, MAX_POST);
      const imageUrl = cleanImageUrl(body.imageUrl);
      if (!content && !imageUrl) throw new HttpError(400, "Write a message or attach a photo first!");
      const [post] = await db
        .insert(posts)
        .values({ id: newId("p"), authorId: user.id, content, tag: cleanTag(body.tag), imageUrl })
        .returning();
      return json({ id: post.id }, 201);
    }

    if (id && !action && method === "DELETE") {
      const user = await requireUser(context);
      const deleted = await db
        .delete(posts)
        .where(and(eq(posts.id, id), eq(posts.authorId, user.id)))
        .returning({ id: posts.id });
      if (!deleted.length) throw new HttpError(404, "Post not found or not yours to delete");
      return json({ ok: true });
    }

    if (id && action === "like" && method === "POST") {
      const user = await requireUser(context);
      await postExists(id);
      const removed = await db
        .delete(likes)
        .where(and(eq(likes.postId, id), eq(likes.userId, user.id)))
        .returning({ postId: likes.postId });
      if (!removed.length) {
        await db.insert(likes).values({ postId: id, userId: user.id }).onConflictDoNothing();
      }
      const all = await db.select({ userId: likes.userId }).from(likes).where(eq(likes.postId, id));
      return json({ liked: !removed.length, likes: all.map((l) => l.userId) });
    }

    if (id && action === "comments" && method === "POST") {
      const user = await requireUser(context);
      const body = await readBody(req);
      const text = str(body.text, MAX_COMMENT);
      if (!text) throw new HttpError(400, "Write a reply first");
      await postExists(id);
      const [comment] = await db
        .insert(comments)
        .values({ id: newId("c"), postId: id, authorId: user.id, text })
        .returning();
      return json(
        {
          id: comment.id,
          authorId: user.id,
          authorName: user.displayName,
          authorHandle: user.handle,
          authorColor: user.avatarColor,
          authorEmoji: user.avatarEmoji,
          text: comment.text,
          createdAt: comment.createdAt.getTime(),
        },
        201,
      );
    }
  }

  // Follow toggle
  if (resource === "follow" && id && !action && method === "POST") {
    const user = await requireUser(context);
    if (id === user.id) throw new HttpError(400, "You can't follow yourself");
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw new HttpError(404, "Creator not found");
    const removed = await db
      .delete(follows)
      .where(and(eq(follows.followerId, user.id), eq(follows.followeeId, id)))
      .returning({ id: follows.followeeId });
    if (!removed.length) {
      await db.insert(follows).values({ followerId: user.id, followeeId: id }).onConflictDoNothing();
    }
    return json(await profileFor(user));
  }

  // Bookmark toggle
  if (resource === "bookmarks" && id && !action && method === "POST") {
    const user = await requireUser(context);
    await postExists(id);
    const removed = await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.postId, id)))
      .returning({ id: bookmarks.postId });
    if (!removed.length) {
      await db.insert(bookmarks).values({ userId: user.id, postId: id }).onConflictDoNothing();
    }
    return json(await profileFor(user));
  }

  throw new HttpError(404, "Not found");
}

export default async (req: Request, context: Context) => {
  try {
    return await route(req, context);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("API error:", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
