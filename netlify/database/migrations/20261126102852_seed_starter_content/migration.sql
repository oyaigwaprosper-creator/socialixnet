-- Custom SQL migration file, put your code below! --
INSERT INTO "users" ("id", "display_name", "handle", "bio", "avatar_color", "avatar_emoji") VALUES
  ('creator_maya', 'Maya Lin', 'mayalin', 'Product designer & coffee enthusiast crafting calm digital spaces.', 'bg-violet-600', '🎨'),
  ('creator_devon', 'Devon Brooks', 'devonbuilds', 'Full-stack engineer shipping open-source tools & cloud apps.', 'bg-emerald-600', '⚡'),
  ('creator_amara', 'Amara Okafor', 'amara_codes', 'Tech storyteller, hiker, and community builder.', 'bg-rose-600', '🌍')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "posts" ("id", "author_id", "content", "tag", "image_url", "created_at") VALUES
  ('seed_post_maya', 'creator_maya', 'Just wrapped up a fresh UI refresh for our mobile workspace! Clean typography, generous breathing room, and fast tactile interactions make all the difference. What are you designing this week?', 'Design', 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80', now() - interval '95 minutes'),
  ('seed_post_devon', 'creator_devon', 'Shipping real-time apps used to require managing WebSocket clusters from scratch. Now with reactive cloud listeners, posts, likes, and comments sync across devices in milliseconds. #BuildInPublic', 'BuildInPublic', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=900&q=80', now() - interval '52 minutes'),
  ('seed_post_amara', 'creator_amara', 'Stepped away from the keyboard for an early morning ridge hike before diving into code reviews. Fresh air is honestly the best debugging tool there is.', 'Lifestyle', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', now() - interval '22 minutes')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "likes" ("post_id", "user_id") VALUES
  ('seed_post_maya', 'creator_devon'),
  ('seed_post_maya', 'creator_amara'),
  ('seed_post_devon', 'creator_maya'),
  ('seed_post_amara', 'creator_maya'),
  ('seed_post_amara', 'creator_devon')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "comments" ("id", "post_id", "author_id", "text", "created_at") VALUES
  ('c_seed_1', 'seed_post_maya', 'creator_devon', 'Love the contrast and spacing on this! Super crisp.', now() - interval '35 minutes'),
  ('c_seed_2', 'seed_post_amara', 'creator_maya', 'That view is unreal! Adding this to my weekend list.', now() - interval '12 minutes')
ON CONFLICT ("id") DO NOTHING;
