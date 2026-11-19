# 规范与施工案例证据检索

资料从 sources 只读入库。首次来源与 source_manifest.json 的 SHA-256 校验，64 份规范和案例库分别登记。源文件、索引、只读版本副本和查询结果分别存于 sources、index、versions、results。

## 运行

需要 Python 3.10+，默认实现使用标准库和 SQLite FTS5，可离线运行。正式代码位于相邻 tools 目录。

    python -B 'tbm-insight/tools/tbm_evidence.py' build
    python -B 'tbm-insight/tools/tbm_evidence.py' search '岩石TBM刀具安装螺栓有什么要求？'
    python -B 'tbm-insight/tools/tbm_evidence.py' search '煤矿TBM遇到地质异常区如何处理？'
    python -B 'tbm-insight/tools/tbm_evidence.py' search '有相似的断层卡机处置案例吗？' --mode case
    python -B 'tbm-insight/tools/verify_evidence.py'

使用其他资料目录时，在 build 或 search 子命令前传入 --root。该目录应包含 sources 和 models.json。--config 可单独覆盖模型配置文件。搜索可用 --standard 精确指定标准编号、--clause 指定条号，或 --region、--machine、--domain、--stage、--geology、--as-of 提供工程条件。默认分别返回最多 5 条规范、5 个案例，--limit 可调整至 1–20。

机型参数接受 open、rock、shield、epb、slurry、double_shield、pipe 及已登记的中文同义词。领域接受 coal、water_project、subway、highway 及对应中文词。地域使用北京、吉林等省级名称。--as-of 使用 YYYY-MM-DD，核对文本实施日期。标准有效状态统一为 unverified，仍需外部核验现行、废止和替代关系。

## 检索口径

默认 models.json 使用 concept_tfidf 和 rules。关键词分支使用 SQLite FTS5，离线向量分支使用双语工程概念词表的 TF-IDF 余弦相似度，两路并行召回，RRF 合并后按对象匹配、正文约束、定义条款、适用条件和内容粒度重排。它支持词表覆盖的同义与跨语言表达。泛化的跨语言语义相似度须用实际多语言嵌入模型进一步验收。

专业词表在 tbm_evidence.py 的 CONCEPTS 中，包含卡机、断层、注浆、刀具、安装、防松等中文词及英文表达。修改词表或模型配置后执行 build，索引会建立对应配置的检索版本。

可配置 OpenAI 兼容嵌入端点，embedding 对象可替换为下列结构。URL 指向完整 embeddings 路由，模型名按部署填写，密钥从指定环境变量读取。

    {"provider":"openai","url":"http://127.0.0.1:8000/v1/embeddings","model":"已部署的多语言模型","api_key_env":"TBM_EMBEDDING_KEY","timeout_seconds":60}

可配置重排端点，reranker 对象使用下列结构。请求为 model、query、documents、top_n，响应为 results 数组，元素包含 index 与 relevance_score。两类外部端点只在显式配置后调用。外部模型的相关性和参数选择仍需在本项目测试集上比较。

    {"provider":"http","url":"http://127.0.0.1:8001/rerank","model":"已部署的重排模型","api_key_env":"TBM_RERANK_KEY","timeout_seconds":60}

模型请求失败时结果中的 retrieval.model_errors 会记录错误类型并使用离线召回或规则重排。retrieval.vector 和 retrieval.reranker 表示配置的后端，结合 model_errors 判断是否发生回退。

## 切分与引用

规范按正文章、节、条号与标题切分，保留上级标题和适用范围。条款内部 Markdown 表格、HTML 表格、单位和注释保持原文。related 补取同一版本中能定位的条款和表格，未能补取的引用在 unresolved_references 中记录。跨标准引用由用户按编号追加查询。

citation 包含条号、Markdown 起止行、文件哈希和版本副本路径，供内部追溯。Web 和对话引用使用同一个原件链接。PDF 在 sources/standards_pdf，PDF 目录在 sources/pdf_catalog.json，按 OCR 文件哈希对应到已入库版本；只有 PDF 的资料也可以从目录查阅。PDF 现从原件首页打开，请用条号核对。OCR 中应、宜、可、不得等用语保持原样。

案例按项目及施工事件切分，保留项目名、地点、机型、地质、问题、措施和结果。21 个无事件项目也登记到索引，常规案例检索跳过空事件。案例来源固定为「本地案例库记录」，original_publication 为空。详情按所引版本的项目和事件生成中文表格。当前案例正文为英文，详情使用设置中的默认模型翻译所查看的记录，并提供英文原文切换。

similarities 给出与问题匹配的主题。differences 和 applicability_notes 给出已识别差异与待补充条件。正文和案例均作为候选证据返回，最终工程结论需与所问对象对应。显式询问能否套用某地域或某标准时，允许返回范围不符的证据用于比较，并标记 scope_mismatch_reference_only。

日期早于文本实施日期、地域或工程领域不符的规范在普通查询中剔除。明确按编号查询或比较适用性时返回差异说明。项目地域未知时，地方标准标记适用性待确认。机型未知的案例保留缺失字段并降低优先级。

## 更新与追溯

build 使用事务更新活跃索引。文件未变时跳过重建；更新、替换或删除时调整活跃版本，旧的文件哈希副本保留。初次入库必须匹配已有 manifest；已登记文件后续变更可增量入库，metadata.manifest_hash_match 记录与最初清单的关系。新增清单外文件的该字段为 false。

查询结果按内容生成文件名写入 results，引用始终指向 versions 下对应哈希的副本。已有副本的哈希在重建和引用时校验。源文件路径不作为历史引用的唯一依据。

## 返回与验收

标准输出为单个 JSON。主要字段包括 status、route、standards、cases、retrieval、evidence_gaps 和 result_file。standards 含原文、元数据、citation、适用核对、相关条款、OCR 提示；cases 含完整项目和事件字段、相似主题、差异及本地定位。

status 为 evidence_found 表示检索到候选证据。insufficient_evidence 表示缺少直接依据。not_needed 表示该问题应进入正常回答或现有工程工具，route=daily_progress 时 suggested_tool=query_tbm_daily_summary。工具不会因为单独出现 TBM 或刀盘就自动给出定义条款。

acceptance.json 覆盖明确规范、同义改写、适用差异、相似案例、无需引用和资料不足。verify_evidence.py 还核对原文哈希和行号、案例字段忠实性、增量更新、历史版本和独立 MCP 调用。results/acceptance_report.json 保存首轮验收题对应的结果文件及引用锚点。

## MCP 接入交接

独立 MCP stdio 入口为 tools/tbm_evidence_server.py，注册工具名 search_tbm_evidence。TBM Insight 的 cordis.patch.yml 已加载独立的 tbm_evidence 服务，模型调用名为 mcp__tbm_evidence__search_tbm_evidence。已有工程工具由 tbm 服务提供。独立运行命令如下。

    python -B 'tbm-insight/tools/tbm_evidence_server.py'

参数为 query、mode、limit 及上述工程条件。返回 content 供模型引用，structuredContent 保留完整证据。模型应按原文措辞回答，说明范围差异；案例引用使用本地案例库记录和项目事件定位；数值或表格涉及工程决策时保留原文核对提示。检索工具不负责判断损伤、生成施工指令或核定标准有效状态。
