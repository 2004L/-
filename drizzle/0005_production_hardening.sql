ALTER TABLE `admin_users` ADD `password_salt` text;
CREATE TABLE IF NOT EXISTS `ai_request_metrics` (
  `id` text PRIMARY KEY NOT NULL,
  `request_id` text NOT NULL UNIQUE,
  `session_id` text,
  `route` text NOT NULL,
  `model` text NOT NULL,
  `latency_ms` integer NOT NULL,
  `prompt_tokens` integer,
  `completion_tokens` integer,
  `total_tokens` integer,
  `outcome` text NOT NULL,
  `created_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `ai_request_metrics_created_idx` ON `ai_request_metrics` (`created_at` DESC);
