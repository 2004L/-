CREATE TABLE `external_commands` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `case_id` text,
  `target` text NOT NULL,
  `operation` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `status` text NOT NULL,
  `request_json` text NOT NULL,
  `result_json` text,
  `error_code` text,
  `retryable` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_commands_idempotency_key_unique` ON `external_commands` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `external_commands_session_idx` ON `external_commands` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `external_commands_case_idx` ON `external_commands` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `simulator_faults` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `case_id` text,
  `target` text NOT NULL,
  `fault_type` text NOT NULL,
  `trigger_on_call` integer DEFAULT 1 NOT NULL,
  `repeat_count` integer DEFAULT 1 NOT NULL,
  `call_count` integer DEFAULT 0 NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `auto_reset` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `simulator_faults_lookup_idx` ON `simulator_faults` (`session_id`,`target`,`enabled`);--> statement-breakpoint
CREATE TABLE `manual_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `case_id` text,
  `command_id` text,
  `department` text NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manual_tasks_session_status_idx` ON `manual_tasks` (`session_id`,`status`,`created_at`);
