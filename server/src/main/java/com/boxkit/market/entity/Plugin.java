package com.boxkit.market.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/** 插件市场条目（当前版本）。 */
@TableName("plugin")
public class Plugin {
    @TableId(type = IdType.AUTO)
    public Long id;

    /** 插件唯一 ID（plugin.json 的 name） */
    public String pluginId;

    public String displayName;

    public String description;

    public String author;

    /** 相对 storage 目录的 logo 路径，如 logos/clipboard-history.svg */
    public String logoUrl;

    public String latestVersion;

    /** 相对 storage 目录的 .bkx 路径，如 plugins/clipboard-history-1.0.0.bkx */
    public String filePath;

    public Long fileSize;

    /** 累计安装次数 */
    public Long downloads;

    public LocalDateTime createdAt;

    public LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long v) { this.id = v; }
    public String getPluginId() { return pluginId; }
    public void setPluginId(String v) { this.pluginId = v; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String v) { this.displayName = v; }
    public String getDescription() { return description; }
    public void setDescription(String v) { this.description = v; }
    public String getAuthor() { return author; }
    public void setAuthor(String v) { this.author = v; }
    public String getLogoUrl() { return logoUrl; }
    public void setLogoUrl(String v) { this.logoUrl = v; }
    public String getLatestVersion() { return latestVersion; }
    public void setLatestVersion(String v) { this.latestVersion = v; }
    public String getFilePath() { return filePath; }
    public void setFilePath(String v) { this.filePath = v; }
    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long v) { this.fileSize = v; }
    public Long getDownloads() { return downloads; }
    public void setDownloads(Long v) { this.downloads = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime v) { this.createdAt = v; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime v) { this.updatedAt = v; }
}
