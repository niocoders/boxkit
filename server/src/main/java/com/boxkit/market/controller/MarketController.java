package com.boxkit.market.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.boxkit.market.common.R;
import com.boxkit.market.entity.Plugin;
import com.boxkit.market.entity.PluginVersion;
import com.boxkit.market.service.MarketService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** 插件市场公开接口（客户端设置页 → 插件市场 消费）。 */
@RestController
@RequestMapping("/api/market")
public class MarketController {

    private final MarketService market;

    public MarketController(MarketService market) {
        this.market = market;
    }

    /** 分页搜索：GET /api/market/plugins?keyword=&page=1&size=20 */
    @GetMapping("/plugins")
    public R<Page<Plugin>> list(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") long page,
            @RequestParam(defaultValue = "20") long size) {
        return R.ok(market.list(keyword, page, Math.min(size, 50)));
    }

    /** 详情 + 历史版本 */
    @GetMapping("/plugins/{pluginId}")
    public R<java.util.Map<String, Object>> detail(@PathVariable String pluginId) {
        Plugin p = market.byId(pluginId);
        if (p == null) return R.error(404, "插件不存在");
        List<PluginVersion> versions = market.versions(pluginId);
        return R.ok(java.util.Map.of("plugin", p, "versions", versions));
    }

    /** 下载 .bkx（客户端安装走这里），带下载计数 */
    @GetMapping("/plugins/{pluginId}/download")
    public ResponseEntity<Resource> download(@PathVariable String pluginId) throws IOException {
        Plugin p = market.byId(pluginId);
        if (p == null) return ResponseEntity.notFound().build();
        Path file = market.openFile(p);
        market.incrDownloads(pluginId);
        String fname = file.getFileName().toString();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fname + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(Files.size(file))
                .body(new FileSystemResource(file));
    }
}
