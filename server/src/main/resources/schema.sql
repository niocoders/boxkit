-- BoxKit 插件市场表结构（幂等：CREATE IF NOT EXISTS）
CREATE TABLE IF NOT EXISTS `market_user` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `password` VARCHAR(100) NOT NULL COMMENT 'BCrypt',
  `nickname` VARCHAR(64) NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_user_username` (`username`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `plugin` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `plugin_id` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(500) NULL,
  `author` VARCHAR(64) NULL,
  `logo_url` VARCHAR(200) NULL,
  `latest_version` VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  `file_path` VARCHAR(200) NOT NULL,
  `file_size` BIGINT NULL,
  `downloads` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_plugin_plugin_id` (`plugin_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `plugin_version` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `plugin_id` VARCHAR(64) NOT NULL,
  `version` VARCHAR(32) NOT NULL,
  `file_path` VARCHAR(200) NOT NULL,
  `file_size` BIGINT NULL,
  `uploaded_by` BIGINT NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_pv_plugin_id` (`plugin_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
