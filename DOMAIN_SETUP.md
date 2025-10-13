# 域名配置说明

## 当前可用的访问方式

### 通过IP地址访问
- 租客系统：http://47.122.68.192/tenant/
- 会议系统：http://47.122.68.192/meeting/
- 人才汇总：http://47.122.68.192/talent-summary/

### 域名配置（需要DNS设置）

服务器已配置支持以下域名：

#### 1. 租客系统专用域名
- 域名：`tenant.cacophonyem.me`
- 状态：Nginx配置已完成，等待DNS解析
- DNS设置要求：
  - 记录类型：A
  - 主机名：tenant
  - 目标IP：47.122.68.192

#### 2. 现有域名（如果DNS已配置）
- `www.cacophonyem.me` - 可通过 `/tenant/` 路径访问租客系统
- `cacophonyem.me` - 可通过 `/tenant/` 路径访问租客系统

## Nginx配置状态

✅ 所有Nginx配置已完成并激活：
- `meeting-with-tenant.conf` - 集成配置（IP + 现有域名）
- `tenant-domain.conf` - 租客系统专用域名配置

## 测试方法

配置DNS后，可通过以下命令测试：
```bash
curl -I http://tenant.cacophonyem.me/
```

## 注意事项

- 如果DNS解析有问题，请先通过IP地址访问
- 所有服务都使用相同的SSL证书
- 静态资源已配置长期缓存