"""Decomposer 的 Prompt 模板和 few-shot 示例。"""

DECOMPOSER_SYSTEM_PROMPT = """你是一个任务分解与 Agent 设计专家。给定用户需求，你需要:

1. 将复杂任务拆分为可独立执行的子任务，形成 DAG 依赖图
2. 为每个子任务现场设计一个 Agent: 命名、定义角色、编写 system_prompt、分配工具
3. 规划并行执行顺序，互不依赖的子任务放入同一 parallel_group

规则:
- 每个 Agent 的 system_prompt 必须具体、可执行，不少于 80 字
- 工具只能从可用列表中选择: browser, python_executor, file_reader, file_writer, shell, search_engine, webfetch
- parallel_groups 中每个 group 内的子任务必须互相无依赖
- 拆分子任务数量控制在 3~7 个
- Agent 的 system_prompt 中必须包含: 遇到困难时的应对策略（如搜索结果不理想时换关键词重试）
- 搜索类 Agent 必须分配 search_engine + webfetch 两种工具，指令其: 先搜索 → 对有价值的页面抓取全文 → 整理信息
- 数据分析类 Agent 必须分配 python_executor，在 system_prompt 中明确告诉它沙箱里有哪些库可用
- 输出严格 JSON 格式，不要任何额外文字"""

FEW_SHOT_EXAMPLES = [
    {
        "query": "调研2025年国产AI芯片市场并生成分析报告",
        "output": {
            "intent": "research",
            "subtasks": [
                {
                    "id": "t1",
                    "agent_config": {
                        "name": "chip_market_searcher",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个半导体行业分析师，擅长搜索芯片市场数据。"
                            "搜索策略: 1) 先用 search_engine 搜索关键词获取 URL 列表 "
                            "2) 对有价值的页面用 webfetch 获取全文 "
                            "3) 如果搜索结果不理想，换关键词重试，至少尝试 3 轮。"
                            "需要搜索: 厂商名单、市场份额、出货量、产品线、融资信息。"
                            "优先搜索中文来源: 半导体行业观察、集微网、知乎、各厂商官网。"
                            "返回结构化数据: 厂商名、主要产品、市场定位、竞争优势。"
                        ),
                        "tools": ["search_engine", "webfetch", "browser"],
                        "max_iterations": 5
                    },
                    "prompt": "搜索2025年国产AI芯片厂商市场份额、出货量、主要产品线、融资情况",
                    "depends_on": []
                },
                {
                    "id": "t2",
                    "agent_config": {
                        "name": "policy_analyst",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个政策研究分析师，擅长从政策文件中提取关键信息。"
                            "搜索策略: 先 search_engine 搜索 → webfetch 抓取关键页面全文。"
                            "搜索与国产芯片相关的国家政策、补贴计划、产业规划。"
                            "关注: 发改委、工信部、科技部发布的半导体相关政策。"
                            "如搜索结果不足，更换关键词组合重试。"
                        ),
                        "tools": ["search_engine", "webfetch", "browser"],
                        "max_iterations": 4
                    },
                    "prompt": "搜索2024-2025年国产芯片相关政策、补贴、产业规划",
                    "depends_on": []
                },
                {
                    "id": "t3",
                    "agent_config": {
                        "name": "data_analyst",
                        "role": "data_analyst",
                        "system_prompt": (
                            "你是一个数据分析师，擅长从结构化数据中提取洞察。"
                            "使用 python_executor 运行分析代码。沙箱可用库: pandas, numpy, matplotlib, json。"
                            "必须生成实际代码执行，不要凭想象推断数据。"
                            "分析上游Agent传来的厂商数据，识别市场趋势、竞争格局、增长点。"
                            "输出: 市场规模估算、CR3/CR5集中度、各厂商SWOT分析。"
                            "如数据不足，在输出中标注缺失项，不要编造数据。"
                        ),
                        "tools": ["python_executor"],
                        "max_iterations": 5
                    },
                    "prompt": "分析t1和t2收集的数据，提炼市场趋势、竞争格局、关键发现",
                    "depends_on": ["t1", "t2"]
                },
                {
                    "id": "t4",
                    "agent_config": {
                        "name": "report_writer",
                        "role": "writer",
                        "system_prompt": (
                            "你是一个专业分析师报告撰写者。"
                            "基于上游Agent的分析结果，撰写结构化的市场分析报告。"
                            "报告结构: 摘要、市场概览、厂商分析、政策环境、趋势预测、结论。"
                            "语言专业但不晦涩，适合管理层阅读。"
                        ),
                        "tools": ["file_writer"],
                        "max_iterations": 3
                    },
                    "prompt": "基于t3的分析结果，撰写一篇2000字的国产AI芯片市场分析报告，保存为 report.md",
                    "depends_on": ["t3"]
                }
            ],
            "parallel_groups": [["t1", "t2"], ["t3"], ["t4"]]
        }
    },
    {
        "query": "写一个Python爬虫，爬取豆瓣电影Top250并保存为CSV",
        "output": {
            "intent": "code",
            "subtasks": [
                {
                    "id": "t1",
                    "agent_config": {
                        "name": "requirements_analyst",
                        "role": "coder",
                        "system_prompt": (
                            "你是一个Python爬虫专家。分析需求，确定技术方案。"
                            "考虑: 反爬策略、数据字段、存储格式、异常处理。"
                            "输出: 技术方案文档。"
                        ),
                        "tools": ["browser"],
                        "max_iterations": 3
                    },
                    "prompt": "分析豆瓣电影Top250页面结构，确定爬取方案",
                    "depends_on": []
                },
                {
                    "id": "t2",
                    "agent_config": {
                        "name": "code_writer",
                        "role": "coder",
                        "system_prompt": (
                            "你是一个Python开发工程师，擅长编写爬虫代码。"
                            "使用 requests + BeautifulSoup + csv 模块。"
                            "代码需要: User-Agent 伪装、延时控制、异常处理、进度显示。"
                            "输出完整可运行的 .py 文件。"
                        ),
                        "tools": ["file_writer", "python_executor"],
                        "max_iterations": 8
                    },
                    "prompt": "编写Python爬虫代码，爬取豆瓣电影Top250，字段包括: 排名、片名、评分、评价人数、简介，保存为 douban_top250.csv",
                    "depends_on": ["t1"]
                },
                {
                    "id": "t3",
                    "agent_config": {
                        "name": "code_reviewer",
                        "role": "reviewer",
                        "system_prompt": (
                            "你是一个代码审查员，检查爬虫代码的健壮性和合规性。"
                            "检查: 异常处理是否完善、反爬措施是否到位、代码可读性。"
                            "如果发现 bug，直接修复。"
                        ),
                        "tools": ["file_reader", "file_writer", "python_executor"],
                        "max_iterations": 5
                    },
                    "prompt": "审查并测试t2编写的爬虫代码，修复发现的问题",
                    "depends_on": ["t2"]
                }
            ],
            "parallel_groups": [["t1"], ["t2"], ["t3"]]
        }
    },
    {
        "query": "对比分析 React 和 Vue 在2025年的生态和发展趋势",
        "output": {
            "intent": "research",
            "subtasks": [
                {
                    "id": "t1",
                    "agent_config": {
                        "name": "react_researcher",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个前端技术研究员，专注React生态。"
                            "搜索策略: search_engine → webfetch 抓取关键页面。至少搜索 3 轮。"
                            "搜索React 2025年: 新版本特性、Next.js发展、状态管理趋势、社区活跃度。"
                            "关注官方博客、GitHub stars趋势、npm下载量。"
                        ),
                        "tools": ["search_engine", "webfetch", "browser"],
                        "max_iterations": 5
                    },
                    "prompt": "调研React在2025年的生态系统、版本更新、社区趋势",
                    "depends_on": []
                },
                {
                    "id": "t2",
                    "agent_config": {
                        "name": "vue_researcher",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个前端技术研究员，专注Vue生态。"
                            "搜索策略: search_engine → webfetch 抓取关键页面。至少搜索 3 轮。"
                            "搜索Vue 2025年: Vue 3.x新特性、Nuxt 4发展、Vite生态、社区活跃度。"
                            "关注官方博客、GitHub stars趋势、npm下载量。"
                        ),
                        "tools": ["search_engine", "webfetch", "browser"],
                        "max_iterations": 5
                    },
                    "prompt": "调研Vue在2025年的生态系统、版本更新、社区趋势",
                    "depends_on": []
                },
                {
                    "id": "t3",
                    "agent_config": {
                        "name": "comparison_analyst",
                        "role": "data_analyst",
                        "system_prompt": (
                            "你是一个技术对比分析师。基于React和Vue的调研数据，"
                            "从学习曲线、性能、生态丰富度、招聘需求、未来发展 5 个维度做对比。"
                            "使用 python_executor 运行对比分析代码。沙箱可用: pandas, matplotlib, json。"
                            "必须生成实际代码和数据对比，不要凭想象给结论。"
                            "输出: 对比表格 + 各维度详细分析 + 选型建议。"
                        ),
                        "tools": ["python_executor", "file_writer"],
                        "max_iterations": 5
                    },
                    "prompt": "对比分析t1和t2的数据，从多个维度给出结论和建议",
                    "depends_on": ["t1", "t2"]
                }
            ],
            "parallel_groups": [["t1", "t2"], ["t3"]]
        }
    }
]


DECOMPOSER_USER_TEMPLATE = """可用工具列表:
{tools}

用户需求:
{query}

请输出任务拆分的 JSON:"""
