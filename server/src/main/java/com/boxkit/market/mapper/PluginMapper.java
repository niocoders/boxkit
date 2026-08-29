package com.boxkit.market.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.boxkit.market.entity.Plugin;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface PluginMapper extends BaseMapper<Plugin> {
    @Update("UPDATE plugin SET downloads = downloads + 1 WHERE plugin_id = #{pluginId}")
    int incrDownloads(String pluginId);
}
