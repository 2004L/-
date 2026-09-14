CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`case_id` text,
	`event_type` text NOT NULL,
	`from_state` text,
	`to_state` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_session_id_idx` ON `audit_events` (`session_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_case_id_idx` ON `audit_events` (`case_id`,`id`);--> statement-breakpoint
CREATE TABLE `browser_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`case_id` text NOT NULL,
	`region` text DEFAULT '广州-演示隔离环境' NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`receipt` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`case_id`) REFERENCES `checkin_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_jobs_case_id_unique` ON `browser_jobs` (`case_id`);--> statement-breakpoint
CREATE INDEX `browser_jobs_session_status_idx` ON `browser_jobs` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `checkin_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`order_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`phone_last4` text NOT NULL,
	`identity_result` text,
	`room_number` text,
	`police_receipt` text,
	`hardware_status` text DEFAULT 'not_started' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `demo_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkin_cases_idempotency_key_unique` ON `checkin_cases` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `checkin_cases_session_order_status_idx` ON `checkin_cases` (`session_id`,`order_id`,`status`);--> statement-breakpoint
CREATE TABLE `demo_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`order_code` text NOT NULL,
	`source` text NOT NULL,
	`guest_label` text NOT NULL,
	`phone_last4` text NOT NULL,
	`phone_masked` text NOT NULL,
	`stay_date` text NOT NULL,
	`nights` integer DEFAULT 1 NOT NULL,
	`room_count` integer DEFAULT 1 NOT NULL,
	`room_type` text NOT NULL,
	`status` text NOT NULL,
	`room_number` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `demo_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_orders_session_order_uq` ON `demo_orders` (`session_id`,`order_code`);--> statement-breakpoint
CREATE INDEX `demo_orders_session_phone_status_idx` ON `demo_orders` (`session_id`,`phone_last4`,`status`);--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`hotel_code` text DEFAULT 'GZ-DEMO-001' NOT NULL,
	`city` text DEFAULT '广州' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
