# BoxKit 插件市场后台（server/）

技术栈：**Spring Boot 2.7.18 + MyBatis-Plus 3.5.3 + Sa-Token 1.39 + MySQL 8**（Java 11+）。

为客户端「设置 → 插件市场」提供插件分发与用户/开发者服务。

## API 一览

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/api/market/plugins?keyword=&page=&size=` | 分页搜索插件（名称/描述/作者） | 否 |
| GET | `/api/market/plugins/{pluginId}` | 详情 + 历史版本 | 否 |
| GET | `/api/market/plugins/{pluginId}/download` | 下载 .bkx（带计数） | 否 |
| POST | `/api/auth/register` | 注册 `{username,password,nickname}` | 否 |
| POST | `/api/auth/login` | 登录 → `{token, tokenName}`（Sa-Token） | 否 |
| GET | `/api/auth/me` | 当前用户 | 是 |
| POST | `/api/dev/plugins` | 发布/更新插件（multipart `file`=.bkx，自动解析 plugin.json/logo） | 是 |

登录后请求头带 `boxkit-token: <token>`。

## 运行（生产：MySQL）

1. 准备 MySQL（本机 3306 即可），数据库可自动创建（JDBC 参数 `createDatabaseIfNotExist=true`）：

```bash
# 密码用环境变量传入，别写死在配置里
MYSQL_PASSWORD=你的密码 mvn -s .mvn/settings.xml -DskipTests package
MYSQL_PASSWORD=你的密码 java -jar target/market-server-1.0.0.jar
# 启动时自动执行 schema.sql（建表）+ data.sql（官方插件 seed）
```

2. 客户端：设置 → 通用 → 插件市场地址，默认 `http://127.0.0.1:8080`；自定义部署后改成你的域名。

3. 发布插件：注册账号 → 登录拿 token → `curl -H "boxkit-token: $TOKEN" -F "file=@my-plugin.bkx" http://127.0.0.1:8080/api/dev/plugins`

## 本地演示（无 MySQL）：H2 profile

```bash
java -Dspring.profiles.active=h2 -jar target/market-server-1.0.0.jar
# H2 内存库（MODE=MySQL），重启数据清空；仅用于联调/演示
```

## 存储

- `.bkx` 与 logo 存于 `./storage/`（`plugins/`、`logos/`），路径入库为相对路径。
- 官方插件 seed：`storage/plugins/clipboard-history-1.0.0.bkx`、`devtoolbox-1.0.0.bkx`（由 `plugins/` 目录打包，PowerShell `Compress-Archive` 即可重生成）。

## 已验证（2026-08-30，H2 profile 实测）

市场列表/中文搜索 ✓ · 下载+计数 ✓ · 注册/登录（BCrypt + Sa-Token）✓ · /me ✓ · 带 token 上传解析 .bkx ✓ · 未登录 401 ✓
