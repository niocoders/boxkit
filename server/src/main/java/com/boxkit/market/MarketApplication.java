package com.boxkit.market;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * BoxKit 插件市场后台。
 * 技术栈：Spring Boot 2.7 + MyBatis-Plus + Sa-Token + MySQL。
 */
@SpringBootApplication
public class MarketApplication {
    public static void main(String[] args) {
        SpringApplication.run(MarketApplication.class, args);
    }
}
