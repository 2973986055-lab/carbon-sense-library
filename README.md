# 阅碳智控 · 图书馆智能控碳数字孪生平台

可直接部署到 GitHub Pages 的静态交互网站。项目面向大学生创新比赛展示，包含：

- 3D 单层空间能源数字孪生
- 314 座自习室占用状态图
- 15–30 分钟人数预测
- 照明与空调协同控制模拟
- 基准、实时感知、预测协同三模式能耗对比
- 节电与碳减排成果展示

## 开源底座

本项目基于 Michael Germini 的 MIT 开源项目
[3D Dashboard – Building Energy Balance](https://github.com/michaelgermini/3d-dashboard-energy-balance-of-a-building)
进行静态网页适配。保留并移植了建筑体块、能源 KPI、侧边导航、趋势图和 CSV
数据回退等核心设计思想，原始授权见 [LICENSE](LICENSE)，改造说明见
[NOTICE.md](NOTICE.md)。

## 本地运行

这是无构建步骤的静态网站，直接打开 `index.html` 即可，也可以使用任意静态文件服务器。

## GitHub Pages

把仓库设为公开，在仓库 Settings → Pages 中选择 `Deploy from a branch`，分支选择
`main`，目录选择 `/ (root)`。
