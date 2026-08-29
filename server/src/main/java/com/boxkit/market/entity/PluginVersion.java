package com.boxkit.market.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/** 插件历史版本。 */
@TableName("plugin_version")
public class PluginVersion {
    @TableId(type = IdType.AUTO)
    public Long id;

    public String pluginId;

    public String version;

    /** 相对 storage 目录的 .bkx 路径 */
    public String filePath;

    public Long fileSize;

    public Long uploadedBy;

    public LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long v) { this.id = v; }
    public String getPluginId() { return pluginId; }
    public void setPluginId(String v) { this.pluginId = v; }
    public String getVersion() { return version; }
    public void setVersion(String v) { this.version = v; }
    public String getFilePath() { return filePath; }
    public void setFilePath(String v) { this.filePath = v; }
    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long v) { this.fileSize = v; }
    public Long getUploadedBy() { return uploadedBy; }
    public void setUploadedBy(Long v) { this.uploadedBy = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime v) { this.createdAt = v; }
}
