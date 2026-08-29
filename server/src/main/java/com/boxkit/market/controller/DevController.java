package com.boxkit.market.controller;

import cn.dev33.satoken.stp.StpUtil;
import com.boxkit.market.common.R;
import com.boxkit.market.entity.Plugin;
import com.boxkit.market.service.MarketService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 开发者上传（需登录）。 */
@RestController
@RequestMapping("/api/dev")
public class DevController {

    private final MarketService market;

    public DevController(MarketService market) {
        this.market = market;
    }

    /** 发布/更新插件：multipart file=.bkx */
    @PostMapping("/plugins")
    public R<Plugin> publish(@RequestParam("file") MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) return R.error(400, "缺少 .bkx 文件");
        long uid = StpUtil.getLoginIdAsLong();
        Plugin p = market.publish(file, uid);
        return R.ok(p);
    }
}
