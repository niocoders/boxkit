package com.boxkit.market.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.boxkit.market.entity.Plugin;
import com.boxkit.market.entity.PluginVersion;
import com.boxkit.market.mapper.PluginMapper;
import com.boxkit.market.mapper.PluginVersionMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** 插件市场核心服务：列表 / 详情 / 上传(.bkx 解析) / 文件下载。 */
@Service
public class MarketService {

    private final PluginMapper pluginMapper;
    private final PluginVersionMapper versionMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${boxkit.market.storage:./storage}")
    public String storageDir;

    public MarketService(PluginMapper pluginMapper, PluginVersionMapper versionMapper) {
        this.pluginMapper = pluginMapper;
        this.versionMapper = versionMapper;
    }

    public Page<Plugin> list(String keyword, long page, long size) {
        LambdaQueryWrapper<Plugin> qw = new LambdaQueryWrapper<>();
        if (keyword != null && !keyword.isBlank()) {
            String kw = keyword.trim();
            qw.like(Plugin::getDisplayName, kw)
              .or().like(Plugin::getDescription, kw)
              .or().like(Plugin::getPluginId, kw)
              .or().like(Plugin::getAuthor, kw);
        }
        qw.orderByDesc(Plugin::getDownloads).orderByDesc(Plugin::getUpdatedAt);
        return pluginMapper.selectPage(new Page<>(page, size), qw);
    }

    public Plugin byId(String pluginId) {
        return pluginMapper.selectOne(new LambdaQueryWrapper<Plugin>()
                .eq(Plugin::getPluginId, pluginId).last("LIMIT 1"));
    }

    public List<PluginVersion> versions(String pluginId) {
        return versionMapper.selectList(new LambdaQueryWrapper<PluginVersion>()
                .eq(PluginVersion::getPluginId, pluginId)
                .orderByDesc(PluginVersion::getVersion));
    }

    /** 下架删除：清理入库记录与磁盘文件（找不到返回 false） */
    public boolean delete(String pluginId) throws IOException {
        Plugin p = byId(pluginId);
        if (p == null) return false;
        Path storage = Paths.get(storageDir).toAbsolutePath().normalize();
        Path file = storage.resolve(p.filePath);
        try { Files.deleteIfExists(file); } catch (IOException ignored) { }
        versionMapper.delete(new LambdaQueryWrapper<PluginVersion>()
                .eq(PluginVersion::getPluginId, pluginId));
        pluginMapper.deleteById(p.getId());
        return true;
    }

    /** 发布/更新插件：解析 .bkx（zip 内含 plugin.json），存文件并入库。 */
    public Plugin publish(MultipartFile bkx, Long uploadedBy) throws IOException {
        byte[] manifestBytes = null;
        byte[] logoBytes = null;
        String logoName = null;

        try (ZipInputStream zis = new ZipInputStream(bkx.getInputStream())) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName();
                if ("plugin.json".equals(name) || name.endsWith("/plugin.json")) {
                    manifestBytes = zis.readAllBytes();
                } else {
                    String base = name.substring(name.lastIndexOf('/') + 1);
                    if (base.startsWith("logo.") && logoBytes == null) {
                        logoBytes = zis.readAllBytes();
                        logoName = base;
                    }
                }
                if (manifestBytes != null && logoBytes != null) break;
            }
        }
        if (manifestBytes == null) {
            throw new IllegalArgumentException(".bkx 包内缺少 plugin.json");
        }
        JsonNode manifest = objectMapper.readTree(manifestBytes);
        String pluginId = manifest.path("name").asText(null);
        String version = manifest.path("version").asText(null);
        if (pluginId == null || pluginId.isBlank() || version == null || version.isBlank()) {
            throw new IllegalArgumentException("plugin.json 缺少 name 或 version");
        }

        // 落盘：<storage>/plugins/<pluginId>-<version>.bkx
        Path storage = Paths.get(storageDir).toAbsolutePath().normalize();
        Path pluginsDir = storage.resolve("plugins");
        Files.createDirectories(pluginsDir);
        String fileName = pluginId + "-" + version + ".bkx";
        Path target = pluginsDir.resolve(fileName);
        bkx.transferTo(target.toFile());

        // logo 落盘：<storage>/logos/<pluginId>.<ext>
        String logoUrl = null;
        if (logoBytes != null && logoName != null) {
            String ext = logoName.substring(logoName.indexOf('.') + 1);
            Path logosDir = storage.resolve("logos");
            Files.createDirectories(logosDir);
            Files.write(logosDir.resolve(pluginId + "." + ext), logoBytes);
            logoUrl = "logos/" + pluginId + "." + ext;
        }

        // 入库：存在则更新（新版本），否则新建
        Plugin plugin = byId(pluginId);
        LocalDateTime now = LocalDateTime.now();
        if (plugin == null) {
            plugin = new Plugin();
            plugin.pluginId = pluginId;
            plugin.displayName = manifest.path("displayName").asText(pluginId);
            plugin.description = manifest.path("description").asText("");
            plugin.author = manifest.path("author").asText("");
            plugin.downloads = 0L;
            plugin.createdAt = now;
        }
        if (logoUrl != null) plugin.logoUrl = logoUrl;
        plugin.latestVersion = version;
        plugin.filePath = "plugins/" + fileName;
        plugin.fileSize = Files.size(target);
        plugin.updatedAt = now;
        if (plugin.id == null) pluginMapper.insert(plugin);
        else pluginMapper.updateById(plugin);

        PluginVersion pv = new PluginVersion();
        pv.pluginId = pluginId;
        pv.version = version;
        pv.filePath = plugin.filePath;
        pv.fileSize = plugin.fileSize;
        pv.uploadedBy = uploadedBy;
        pv.createdAt = now;
        versionMapper.insert(pv);

        return plugin;
    }

    /** 打开插件 .bkx 文件流（下载计数由 controller 处理）。 */
    public Path openFile(Plugin plugin) throws IOException {
        Path p = Paths.get(storageDir).toAbsolutePath().normalize().resolve(plugin.filePath);
        if (!Files.exists(p)) throw new IllegalArgumentException("插件文件缺失: " + plugin.filePath);
        return p;
    }

    public void incrDownloads(String pluginId) {
        pluginMapper.incrDownloads(pluginId);
    }

    /** 从目录直接导入插件文件（seed 用，不经 zip 解析）。 */
    public int seedFromDir(Path pluginsDir) throws IOException {
        if (!Files.exists(pluginsDir)) return 0;
        List<Path> bkxs = new ArrayList<>();
        try (var stream = Files.list(pluginsDir)) {
            stream.filter(p -> p.toString().endsWith(".bkx")).forEach(bkxs::add);
        }
        int created = 0;
        for (Path bkx : bkxs) {
            String fileName = bkx.getFileName().toString();
            String base = fileName.substring(0, fileName.length() - 4); // 去掉 .bkx
            String pluginId = base.replaceAll("-[0-9.]+$", "");
            if (byId(pluginId) != null) continue;
            Plugin p = new Plugin();
            p.pluginId = pluginId;
            p.displayName = pluginId;
            p.description = "官方内置插件";
            p.author = "BoxKit Official";
            p.filePath = "plugins/" + fileName;
            try { p.fileSize = Files.size(bkx); } catch (IOException ignored) { p.fileSize = 0L; }
            p.downloads = 0L;
            p.createdAt = p.updatedAt = LocalDateTime.now();
            pluginMapper.insert(p);
            created++;
        }
        return created;
    }
}
