-- 官方插件 seed（幂等：仅当 plugin_id 不存在时插入；文件由 storage/plugins/*.bkx 提供）
INSERT IGNORE INTO `plugin`
  (`plugin_id`, `display_name`, `description`, `author`, `latest_version`, `file_path`, `downloads`, `created_at`, `updated_at`)
VALUES
  ('clipboard-history', '剪贴板历史', '记录并回贴剪贴板历史，支持文本条目去重与一键复制', 'BoxKit Official', '1.0.0', 'plugins/clipboard-history-1.0.0.bkx', 0, NOW(), NOW()),
  ('devtoolbox', 'DevToolbox 开发工具箱', '时间戳转换（支持接管搜索框实时解析）、JSON 格式化、UUID 生成', 'BoxKit Official', '1.0.0', 'plugins/devtoolbox-1.0.0.bkx', 0, NOW(), NOW());
