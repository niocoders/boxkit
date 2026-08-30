package com.boxkit.market.controller;

import com.boxkit.market.common.R;
import com.boxkit.market.entity.Plugin;
import com.boxkit.market.service.MarketService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/**
 * 管理端接口（Web 管理门户 /admin.html 使用）。
 * 注意：本接口按设计不做登录鉴权——请部署于内网或由反向代理加防护。
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final MarketService market;

    public AdminController(MarketService market) {
        this.market = market;
    }

    /** 发布/更新插件：multipart file=.bkx（自动解析 plugin.json 与 logo） */
    @PostMapping("/plugins")
    public R<Plugin> publish(@RequestParam("file") MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) return R.error(400, "缺少 .bkx 文件");
        Plugin p = market.publish(file, null);
        return R.ok(p);
    }

    /** 下架并删除插件（含历史版本记录与磁盘文件） */
    @DeleteMapping("/plugins/{pluginId}")
    public R<Void> delete(@PathVariable String pluginId) throws Exception {
        market.delete(pluginId);
        return R.ok();
    }
}
