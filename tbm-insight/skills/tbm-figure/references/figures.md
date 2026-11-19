# TBM Insight 绘图参考

| 图型 | 工程问题 | 数据和表达 |
| --- | --- | --- |
| 掘进工况趋势 | 指定时段如何运行 | 各测点使用独立纵轴，共享现场时间轴。常规曲线通过游标或明细读数，静态图按问题选标峰值和关键时刻。 |
| 参数限值 | 哪个测点何时达到设定 | 蓝实线为实测，棕色虚线和红色点线为同秒 PLC 预警及报警设定。设置变化画阶梯；用三角或方形标出值得复核的触及峰值。事件持续时间和超出量从明细表读取。 |
| 日掘进进度 | 当天何时形成新进尺 | 相对桩号实测用蓝实线，新增掘进估算用紫色点划线，标出当日最终新增量，底部标出掘进和 PLC 估算停机区间。 |
| 周掘进进度 | 本周每天和累计进度如何 | 周一至周日逐日显示新增掘进、累计新增掘进和掘进用时占比。每日柱端、累计点和占比点直接标值。桩号量图上保留两位小数，占比保留一位小数，原始精度可查 JSON。占比分母为各日零点至最后实测的时长，缺测计入未判定。 |
| 刀位处理次数 | 哪些刀位反复处理 | 按处理次数和刀位号排序，横条按台账原因堆叠，柱端标处理总数，原因明细可查台账。 |
| 刀位处理事件 | 哪一天处理了哪些刀位 | 日期为横轴，刀位为纵轴，同日同位次数以标记和数字提示。明细可按台账行核对。 |

## 图表数据

PNG 描述及工程工具 JSON 的 `figure_data` 使用以下字段。工程统计和事件明细仍可从工具的原有字段读取。

| 字段 | 内容 |
| --- | --- |
| `kind`, `device` | 图型标识、设备标识 |
| `metrics[]` | `key`、标签、`unit`、`unit_status` 和 `value_kind`。历史未确认单位用空值，标记 `unverified`。 |
| `window`, `observed_window` | 查询窗口与实测覆盖。窗口的结束边界排除，现场时刻按原始档案读取。 |
| `sample_count` | 输入记录条数；周图计有实测的日期数。 |
| `missing` | 图型对应的缺测摘要、未观测区间或日期。 |
| `source` | 源 ZIP、TXT 或 Excel、物理行号及相应图型的证据定位。 |

相同现场秒的重复记录用一致的值展示。字段值冲突时该秒相应字段断线，工程工况统计仍按原始记录计算。Web 压缩在每个桶的每个连续有效段内保留首末与峰谷，PLC 设定保留每次变化、每段首尾及断点。Web 工况可在已保留的相邻点间显示估算读数，缺测段禁用插值。

共享模块为 [tbm_figure.py](../../../tools/tbm_figure.py)，样式源为 [tbm_figure_style.json](../../../tools/tbm_figure_style.json)。PNG 以 180 DPI 导出，画布尺寸由图型和版面决定。对齐的全天图和七日图使用 10 英寸宽的画布与统一的绘图区左右边界，按子图数和标签调整高度。全天图每四小时一格，七日图每日一格，并保留缺测日期的位置。优先字体为 Times New Roman 与 SimSun，随后依配置回退。图使用黑色四边框、内向刻度，背景无网格。看板从查询结果读取样式，交互查询无需生成 PNG。

## 开发版运行

开发版 `start.ps1` 读取项目的 `cordis.patch.yml`，通过 `tbm-insight-skills` 加载 `tbm-insight/skills`。在 Web 会话输入 `/tbm-figure` 可选择该技能。周进度会话工具在 `query_tbm_daily_summary` 传 `week_of`，日期选择其所在自然周。给 `include_chart` 传 `false` 可仅查数值。

Windows 安装 Matplotlib 即可本地绘制 PNG。刀具台账由工具直接读取 XLSX。图表优先使用机器已安装的宋体和 Times New Roman。以下命令从原档重新生成六张图及其 JSON，输出路径可改。

```powershell
Set-Location './tbm-insight'
$figures = './samples/figure-acceptance'
New-Item -ItemType Directory -Path $figures -Force | Out-Null
python -B -X utf8 tools/tbm_insight.py --data-dir '<PLC 数据目录>' --device CREC188 --start '2016-12-15 18:17:00' --end '2016-12-15 18:22:00' --output-dir $figures | Set-Content -Encoding utf8 "$figures/conditions.json"
python -B -X utf8 tools/tbm_limits.py --date 2016-12-15 --output-dir $figures | Set-Content -Encoding utf8 "$figures/limits.json"
python -B -X utf8 tools/tbm_daily_summary.py --date 2016-07-24 --scope summary --output-dir $figures | Set-Content -Encoding utf8 "$figures/day.json"
'{"panel":"progress","date":"2016-07-24"}' | python -B -X utf8 tools/tbm_panel_data.py --output-dir "$figures/cache" --figure-dir $figures | Set-Content -Encoding utf8 "$figures/week.json"
python -B -X utf8 tools/tbm_cutter_changes.py --start-date 2016-07-18 --end-date 2016-07-25 --output-dir $figures | Set-Content -Encoding utf8 "$figures/cutters.json"
```

验收锚点为工况 300 条，周进度 257.56640625 原始桩号量及 279730 秒估算停机，换刀 52 条原始记录、53 次处理、23 个刀位。查看限值报告时，2016-12-15 主液压油箱温度有 3073 条达到预警设定，0 条达到报警设定。
