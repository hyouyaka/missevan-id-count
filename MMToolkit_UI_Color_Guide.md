# 小猫小狐数据分析：首页 UI 配色规范

> 适用于 Codex 实现首页 UI 配色调整。  
> 目标：保持白色系背景、简洁明快、有足够对比度，同时避免页面显得单调、灰暗或饱和度过低。

---

## 1. 设计方向

整体使用以下配色逻辑：

- **白色与冷白灰**作为页面和卡片背景
- **清透蓝**作为主品牌色和主要交互色
- **漫播品牌紫色**作为漫播平台主题色
- **珊瑚橙**继续作为局部点缀色，用于提亮和制造视觉节奏
- **青绿色**仅用于正向增长、成功状态
- **金 / 银 / 铜**用于榜单名次
- 深色文字负责信息层级，避免大面积浅灰文字导致页面发虚

不要使用大面积高饱和色块。颜色主要应用于：

- 图标
- 平台标签
- 数字徽标
- 链接
- Tab 选中态
- 局部浅色背景
- 少量强调线条

---

## 2. 核心配色变量

建议统一写入全局 CSS Variables。

```css
:root {
  /* Page surfaces */
  --color-page-bg: #F7F9FC;
  --color-surface: #FFFFFF;
  --color-surface-hover: #FBFCFE;
  --color-surface-subtle: #F8FAFC;

  /* Primary brand blue */
  --color-primary: #2563EB;
  --color-primary-hover: #1D4ED8;
  --color-primary-active: #1E40AF;
  --color-primary-soft: #EFF6FF;
  --color-primary-border: #BFDBFE;

  /* Manbo brand purple */
  --color-manbo: #915AF6;
  --color-manbo-hover: #7C3FE4;
  --color-manbo-active: #6930C9;
  --color-manbo-soft: #F4EFFF;
  --color-manbo-border: #DCCBFF;

  /* Coral accent — remains an accent color */
  --color-coral: #F97355;
  --color-coral-hover: #EA6042;
  --color-coral-soft: #FFF1ED;
  --color-coral-border: #FFD2C7;

  /* Positive / success */
  --color-success: #10A37F;
  --color-success-hover: #087F63;
  --color-success-soft: #EAF9F4;

  /* Ranking */
  --color-rank-gold: #F59E0B;
  --color-rank-gold-soft: #FFF7E6;
  --color-rank-silver: #718096;
  --color-rank-silver-soft: #F1F5F9;
  --color-rank-bronze: #C56A32;
  --color-rank-bronze-soft: #FFF1E8;

  /* Text */
  --color-text-primary: #172033;
  --color-text-secondary: #526071;
  --color-text-muted: #8995A5;
  --color-text-disabled: #B4BCC8;
  --color-text-inverse: #FFFFFF;

  /* Borders */
  --color-border: #E2E8F0;
  --color-border-strong: #CBD5E1;
  --color-divider: #E9EEF5;

  /* Shadows */
  --shadow-card: 0 4px 16px rgba(30, 50, 80, 0.05);
  --shadow-card-hover: 0 8px 24px rgba(37, 99, 235, 0.09);
  --shadow-header: 0 1px 0 rgba(23, 32, 51, 0.06);
}
```

---

## 3. 漫播主题色调整

漫播平台不再使用珊瑚橙作为主题色，改为品牌紫色：

```css
--color-manbo: #915AF6;
```

该颜色取自参考图中“热度”文字的主色。

### 漫播主题色适用范围

仅用于和漫播平台直接相关的元素：

- 漫播平台图标
- 漫播平台名称
- 漫播数量徽标
- 漫播 Tab 选中态
- 漫播卡片轻量强调
- 漫播相关按钮、链接或 focus ring
- 漫播平台浅色背景

示例：

```css
.platform-manbo {
  color: var(--color-manbo);
}

.platform-manbo-badge {
  color: var(--color-manbo);
  background: var(--color-manbo-soft);
  border: 1px solid var(--color-manbo-border);
}

.platform-manbo-tab[aria-selected="true"] {
  color: var(--color-manbo);
  background: var(--color-manbo-soft);
  border-color: var(--color-manbo-border);
}
```

### 不要把所有珊瑚橙替换为紫色

珊瑚橙仍然保留，作为页面的辅助点缀色，用于：

- “榜单速览”标题旁的小图标或强调线
- hover 状态中的局部点缀
- 特殊提示
- 少量高亮装饰
- 与蓝色、紫色平衡的暖色元素

珊瑚橙不应再承担漫播平台识别功能。

---

## 4. 页面背景与层级

### 页面背景

```css
body {
  background: var(--color-page-bg);
  color: var(--color-text-primary);
}
```

不要让整个页面使用纯白背景，否则卡片边界不明显。

### 卡片

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}
```

### 卡片 Hover

```css
.card:hover {
  border-color: var(--color-primary-border);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}
```

建议过渡：

```css
.card {
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}
```

不要使用明显的渐变、重阴影或大面积发光效果。

---

## 5. 顶部导航栏

### Header

```css
.app-header {
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-header);
}
```

### 品牌标题

```css
.app-title {
  color: var(--color-text-primary);
  font-weight: 700;
}

.app-brand-label {
  color: var(--color-primary);
  letter-spacing: 0.14em;
  font-weight: 700;
}
```

Logo 保持深色底，不建议直接改成纯蓝或纯紫。

---

## 6. 搜索框

### 默认状态

```css
.search-input {
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.search-input::placeholder {
  color: var(--color-text-muted);
}
```

### Focus 状态

```css
.search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  outline: none;
}
```

搜索框属于全站功能，不随平台切换改变颜色，始终使用主蓝色。

---

## 7. 区块标题

主区块标题使用深色正文，不要整行使用蓝色。

```css
.section-title {
  color: var(--color-text-primary);
  font-weight: 700;
}
```

标题图标：

```css
.section-title-icon {
  color: var(--color-primary);
}
```

“榜单速览”可用珊瑚橙作为局部点缀：

```css
.ranking-section .section-title-icon {
  color: var(--color-coral);
}
```

这样可以增加冷暖对比，但不要让珊瑚橙覆盖整个标题。

---

## 8. 猫耳与漫播平台配色

### 猫耳

```css
.platform-missevan {
  --platform-color: var(--color-primary);
  --platform-soft: var(--color-primary-soft);
  --platform-border: var(--color-primary-border);
}
```

推荐表现：

- 图标：主蓝
- 名称：主蓝
- 数量徽标：浅蓝底 + 主蓝字
- 选中 Tab：浅蓝底 + 蓝色边框
- 未选中态：中性灰

### 漫播

```css
.platform-manbo {
  --platform-color: var(--color-manbo);
  --platform-soft: var(--color-manbo-soft);
  --platform-border: var(--color-manbo-border);
}
```

推荐表现：

- 图标：品牌紫
- 名称：品牌紫
- 数量徽标：浅紫底 + 紫色字
- 选中 Tab：浅紫底 + 紫色边框
- 未选中态：中性灰

### 平台 Badge

```css
.platform-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--platform-color);
  background: var(--platform-soft);
  border: 1px solid var(--platform-border);
  border-radius: 999px;
  padding: 3px 8px;
  font-weight: 600;
}
```

---

## 9. 平台切换 Tab

```css
.platform-tab {
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid transparent;
}

.platform-tab:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.platform-tab.missevan[aria-selected="true"] {
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-color: var(--color-primary-border);
}

.platform-tab.manbo[aria-selected="true"] {
  color: var(--color-manbo);
  background: var(--color-manbo-soft);
  border-color: var(--color-manbo-border);
}
```

Tab 不建议做成重色实心按钮，保持轻量化。

---

## 10. 文本层级

```css
.item-title {
  color: var(--color-text-primary);
  font-weight: 650;
}

.item-meta {
  color: var(--color-text-secondary);
}

.item-date,
.item-update-time,
.section-description {
  color: var(--color-text-muted);
}
```

建议：

- 标题：深蓝黑
- CV / 作者：中灰
- 日期 / 更新时间：浅灰
- 不要所有文字都使用蓝灰色
- 可点击标题 hover 时再变为主色

```css
.item-title-link:hover {
  color: var(--color-primary);
}
```

漫播内容标题不需要全部使用紫色。紫色仅用于平台识别和交互强调。

---

## 11. 数据与增长数字

总播放量：

```css
.metric-value {
  color: var(--color-text-secondary);
}
```

增长值：

```css
.metric-growth {
  color: var(--color-success);
  font-weight: 650;
}
```

可选轻量标签形式：

```css
.metric-growth-badge {
  color: var(--color-success-hover);
  background: var(--color-success-soft);
  border-radius: 999px;
  padding: 2px 6px;
}
```

不要使用绿色表示普通按钮、平台或非增长状态。

---

## 12. 链接与按钮

普通全站链接默认使用主蓝色：

```css
.link {
  color: var(--color-primary);
}

.link:hover {
  color: var(--color-primary-hover);
}
```

漫播卡片内部与平台直接相关的动作，可使用漫播紫色：

```css
.manbo-card .platform-link {
  color: var(--color-manbo);
}

.manbo-card .platform-link:hover {
  color: var(--color-manbo-hover);
}
```

“查看更多”属于导航动作，建议默认保持主蓝色，避免同一页面出现过多不同颜色的链接。

---

## 13. 排名颜色

```css
.rank-1 {
  color: #B76E00;
  background: var(--color-rank-gold-soft);
  border-color: #F6C65B;
}

.rank-2 {
  color: #5F6B7A;
  background: var(--color-rank-silver-soft);
  border-color: #D8DEE8;
}

.rank-3 {
  color: #A65325;
  background: var(--color-rank-bronze-soft);
  border-color: #F2C3A7;
}
```

排名徽标应保持小尺寸、低装饰性，不使用大面积金属渐变。

---

## 14. 分割线与边框

列表项之间使用：

```css
.list-item + .list-item {
  border-top: 1px solid var(--color-divider);
}
```

模块外边框：

```css
border: 1px solid var(--color-border);
```

不要使用过深的灰色边框，也不要完全移除边框后只依赖阴影。

---

## 15. 推荐页面颜色占比

建议整体比例：

- 约 **75%**：白色、冷白灰背景
- 约 **15%**：深色文字、边框和中性色
- 约 **6%**：主蓝色
- 约 **2%**：漫播紫色
- 约 **1%**：珊瑚橙
- 约 **1%**：绿色、金银铜状态色

颜色强调应集中在关键区域，而不是平均分布到所有元素。

---

## 16. 无障碍与对比度

必须确保：

- 正文文字与白色背景之间有足够对比度
- `#8995A5` 只用于次要信息，不用于正文主内容
- 小字号文字优先使用 `#526071`
- 不使用浅紫、浅蓝或浅橙直接作为正文文字颜色
- 彩色文字用于关键标签时，字号建议不低于 13px，字重不低于 600
- hover、focus、selected 状态不能只依赖颜色区分，需同时有边框、背景或下划线

---

## 17. Codex 实现约束

请严格遵守：

1. 不更改现有页面结构和数据内容。
2. 不新增模块、统计项或装饰性内容。
3. 不使用大面积渐变。
4. 不使用高强度玻璃拟态。
5. 不使用重阴影。
6. 不将所有链接和标题都改为彩色。
7. 猫耳使用主蓝色。
8. 漫播使用品牌紫色 `#915AF6`。
9. 珊瑚橙保留为独立点缀色，不代表漫播。
10. 增长数字统一使用青绿色。
11. 卡片以边框建立层级，阴影仅作为辅助。
12. 所有颜色优先引用 CSS Variables，不在组件中散落硬编码值。

---

## 18. 快速应用示例

```css
.home-page {
  min-height: 100vh;
  background: var(--color-page-bg);
  color: var(--color-text-primary);
}

.update-card,
.ranking-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}

.update-card:hover,
.ranking-card:hover {
  border-color: var(--color-primary-border);
  box-shadow: var(--shadow-card-hover);
}

.update-card--missevan .platform-label {
  color: var(--color-primary);
}

.update-card--manbo .platform-label {
  color: var(--color-manbo);
}

.update-card--missevan .platform-count {
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border: 1px solid var(--color-primary-border);
}

.update-card--manbo .platform-count {
  color: var(--color-manbo);
  background: var(--color-manbo-soft);
  border: 1px solid var(--color-manbo-border);
}

.metric-growth {
  color: var(--color-success);
}

.ranking-section-icon {
  color: var(--color-coral);
}
```

---

## 19. 最终主色摘要

| 用途 | 颜色 |
|---|---|
| 页面背景 | `#F7F9FC` |
| 卡片背景 | `#FFFFFF` |
| 猫耳 / 主品牌蓝 | `#2563EB` |
| 漫播品牌紫 | `#915AF6` |
| 珊瑚橙点缀 | `#F97355` |
| 增长绿 | `#10A37F` |
| 主文字 | `#172033` |
| 次级文字 | `#526071` |
| 弱化文字 | `#8995A5` |
| 默认边框 | `#E2E8F0` |
| 一级排名 | `#F59E0B` |
| 二级排名 | `#718096` |
| 三级排名 | `#C56A32` |

这套方案应作为首页和后续相关页面的统一配色基础。
