// 配置值类型
export type ConfigType = 'bool' | 'int' | 'string' | 'json'

// 数据库配置全字段
export interface SysConfig {
  id: number
  config_key: string
  config_value: string
  config_desc: string
  config_type: ConfigType
  created_at: string
  updated_at: string
}

// Redis缓存存储精简结构
export type ConfigCacheItem = {
  config_key: string
  config_value: string
  config_type: ConfigType
}

// Redis全局缓存Key
export const REDIS_GLOBAL_CONFIG_KEY = 'sys:config:global'