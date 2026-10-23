# -*- coding: utf-8 -*-
"""生成《时光围棋 ShiGuang-Go 创业立项书》.docx"""

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

# ---------------- 配色 ----------------
INK = RGBColor(0x1A, 0x1A, 0x1A)
ACCENT = RGBColor(0x8B, 0x5A, 0x2B)      # 木色调，呼应棋盘
MUTED = RGBColor(0x60, 0x60, 0x60)
BODY_FONT = "宋体"
HEAD_FONT = "黑体"
EN_FONT = "Times New Roman"


def set_run_font(run, ascii_font=EN_FONT, east_font=BODY_FONT, size=None,
                 bold=None, color=None):
    run.font.name = ascii_font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), east_font)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def style_setup(doc):
    normal = doc.styles["Normal"]
    normal.font.name = EN_FONT
    normal.font.size = Pt(10.5)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    pf = normal.paragraph_format
    pf.line_spacing = 1.5
    pf.space_after = Pt(0)

    for lvl, size in ((1, 16), (2, 13), (3, 11)):
        st = doc.styles[f"Heading {lvl}"]
        st.font.name = HEAD_FONT
        st.font.size = Pt(size)
        st.font.bold = True
        st.font.color.rgb = INK if lvl > 1 else ACCENT
        st._element.rPr.rFonts.set(qn("w:eastAsia"), HEAD_FONT)
        st.paragraph_format.space_before = Pt(14 if lvl == 1 else 10)
        st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.line_spacing = 1.3
        st.paragraph_format.keep_with_next = True


def add_para(doc, text="", size=10.5, bold=False, color=INK, align=None,
             indent=True, space_before=0, space_after=4, line=1.5):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if indent:
        pf.first_line_indent = Pt(size * 2)
    if align is not None:
        p.alignment = align
    if text:
        r = p.add_run(text)
        set_run_font(r, size=size, bold=bold, color=color)
    return p


def add_rich(doc, segments, size=10.5, indent=True, space_after=4, line=1.5):
    """segments: list of (text, bold)"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if indent:
        pf.first_line_indent = Pt(size * 2)
    for text, bold in segments:
        r = p.add_run(text)
        set_run_font(r, size=size, bold=bold, color=INK)
    return p


def add_bullet(doc, text, bold_prefix=None, size=10.5):
    p = doc.add_paragraph(style="List Bullet")
    pf = p.paragraph_format
    pf.space_after = Pt(2)
    pf.line_spacing = 1.45
    if bold_prefix:
        r0 = p.add_run(bold_prefix)
        set_run_font(r0, size=size, bold=True, color=INK)
    r = p.add_run(text)
    set_run_font(r, size=size, color=INK)
    return p


def add_numbered(doc, text, bold_prefix=None, size=10.5):
    p = doc.add_paragraph(style="List Number")
    pf = p.paragraph_format
    pf.space_after = Pt(2)
    pf.line_spacing = 1.45
    if bold_prefix:
        r0 = p.add_run(bold_prefix)
        set_run_font(r0, size=size, bold=True, color=INK)
    r = p.add_run(text)
    set_run_font(r, size=size, color=INK)
    return p


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hexcolor)
    tcPr.append(shd)


def set_repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def add_table(doc, headers, rows, widths=None, size=9, header_fill="E8DCC8"):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    # 禁止行跨页断开：避免表格底部越界后把末行挤到下一页形成空白页
    tPr = t._tbl.tblPr
    cant = OxmlElement("w:cantSplit")
    cant.set(qn("w:val"), "true")
    tPr.append(cant)
    hdr = t.rows[0]
    set_repeat_header(hdr)
    for i, h in enumerate(headers):
        c = hdr.cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.15
        r = p.add_run(h)
        set_run_font(r, size=size, bold=True, color=INK, east_font=HEAD_FONT)
        shade(c, header_fill)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            c = cells[i]
            c.text = ""
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.2
            bold = val.startswith("**") and val.endswith("**")
            txt = val.strip("*")
            r = p.add_run(txt)
            set_run_font(r, size=size, bold=bold, color=INK)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)

    # 行级 cantSplit，并取消表后段落的段前间距，压缩表格底部占用
    for row in t.rows:
        trPr = row._tr.get_or_add_trPr()
        cs = OxmlElement("w:cantSplit")
        cs.set(qn("w:val"), "true")
        trPr.append(cs)

    # 表后间隔：用小字号段落占位，避免表格排满整页时多出空白页
    gap = doc.add_paragraph()
    gpf = gap.paragraph_format
    gpf.space_before = Pt(0)
    gpf.space_after = Pt(2)
    gpf.line_spacing = 1.0
    gr = gap.add_run("")
    gr.font.size = Pt(2)
    return t


def drop_trailing_gap(doc):
    """删除紧跟在表格之后的间隔空段。

    原因：该空段若恰好落在页底，会被推到下一页形成一个整页空白。
    删除后表与后续标题直接衔接，标题样式自带段前距离，视觉上无差异。
    """
    body = doc.element.body
    for tbl in list(body.iterchildren()):
        if not tbl.tag.endswith("}tbl"):
            continue
        nxt = tbl.getnext()
        if nxt is not None and nxt.tag.endswith("}p"):
            if not "".join(nxt.itertext()).strip():
                body.remove(nxt)


def add_note(doc, text, size=9):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(2)
    pf.space_after = Pt(8)
    pf.line_spacing = 1.3
    r = p.add_run(text)
    set_run_font(r, size=size, color=MUTED)
    return p


def add_page_field(paragraph):
    run = paragraph.add_run()
    f1 = OxmlElement("w:fldChar"); f1.set(qn("w:fldCharType"), "begin")
    it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve"); it.text = " PAGE "
    f2 = OxmlElement("w:fldChar"); f2.set(qn("w:fldCharType"), "end")
    run._r.append(f1); run._r.append(it); run._r.append(f2)
    set_run_font(run, size=9, color=MUTED)


def hr(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(4)
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "C8B48F")
    bdr.append(bottom)
    pPr.append(bdr)


# =====================================================================
doc = Document()
style_setup(doc)

sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(2.5)
sec.bottom_margin = Cm(2.3)
sec.left_margin = Cm(2.6)
sec.right_margin = Cm(2.6)

# 页脚页码
footer_p = sec.footer.paragraphs[0]
footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
add_page_field(footer_p)

# ---------------- 封面 ----------------
for _ in range(5):
    doc.add_paragraph()

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("创业立项书")
set_run_font(r, size=36, bold=True, color=INK, east_font=HEAD_FONT)

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("时光围棋 ShiGuang-Go")
set_run_font(r, size=22, bold=True, color=ACCENT, east_font=HEAD_FONT)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(10)
r = p.add_run("面向围棋教育的本地化 AI 训练平台")
set_run_font(r, size=13, color=MUTED, east_font=HEAD_FONT)

for _ in range(6):
    doc.add_paragraph()

hr(doc)
info = [
    ("项目名称", "时光围棋 ShiGuang-Go"),
    ("项目主体", "个人独立开发阶段，尚未注册公司"),
    ("产品形态", "Windows x64 桌面软件（Tauri 2 + Vue 3 + Rust + KataGo）"),
    ("当前版本", "v1.1.0（已发布可安装安装包）"),
    ("文档版本", "v1.0"),
    ("编制日期", "2026 年 10 月"),
]
t = doc.add_table(rows=0, cols=2)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
for k, v in info:
    cells = t.add_row().cells
    cells[0].width = Cm(3.6)
    cells[1].width = Cm(10.5)
    for idx, (txt, bold) in enumerate(((k, True), (v, False))):
        pp = cells[idx].paragraphs[0]
        pp.paragraph_format.space_after = Pt(3)
        pp.paragraph_format.line_spacing = 1.2
        rr = pp.add_run(txt)
        set_run_font(rr, size=10.5, bold=bold, color=INK if bold else MUTED,
                     east_font=HEAD_FONT if bold else BODY_FONT)
hr(doc)

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("本文档中标注「待核实」的数据，均为需要补充公开来源链接的估算或行业口径，"
              "提交前应逐条核实。")
set_run_font(r, size=8.5, color=MUTED)

doc.add_page_break()

# ---------------- 目录说明 ----------------
doc.add_heading("阅读指引", level=1)
add_para(doc,
         "本立项书面向大学生创新创业类竞赛（“互联网+”“挑战杯”等）通用评审场景撰写，"
         "兼顾“创意组”对完整商业计划的要求与“初创组”对已上线产品、技术壁垒与成长性的要求。"
         "全文遵循三条原则：")
add_bullet(doc, "所有关于产品的描述均可在现有代码与已发布安装包中验证，不虚构功能。",
           bold_prefix="不说空话——")
add_bullet(doc, "市场数据采用可核查的公开口径，无法确认的一律标注「待核实」，不编造精确数字。",
           bold_prefix="不造数据——")
add_bullet(doc, "“竞品分析”与“风险与应对”两章完整披露短板，包括产品当前的硬伤，"
                "因为这正是评审最关心的部分。",
           bold_prefix="不避短板——")

add_para(doc,
         "全文结构对应评审表的六大评分维度：项目概述（创意）、技术与产品（创新性）、"
         "市场分析（行业与竞争）、商业模式（可行性）、团队与执行（成长性）、社会价值与风险。"
         "如用于路演，建议另配套 10–14 页演示文稿，聚焦第三章技术创新与第六章商业模式。",
         space_before=6)

# =====================================================================
doc.add_page_break()
doc.add_heading("一、项目概述", level=1)

doc.add_heading("1.1 一句话定位", level=2)
p = add_para(doc, "", indent=False)
r = p.add_run("让每一个围棋学员都拥有一台不联网、不付费、不会泄题的私人 AI 教练。")
set_run_font(r, size=13, bold=True, color=ACCENT, east_font=HEAD_FONT)

doc.add_heading("1.2 项目简介", level=2)
add_para(doc,
         "时光围棋（ShiGuang-Go）是一款运行于 Windows 桌面端的本地 AI 围棋训练软件。"
         "它将开源围棋 AI 引擎 KataGo、围棋规则引擎、形势判断工具与棋谱管理能力整合为一个"
         "开箱即用的完整产品，用户无需配置命令行、无需编译环境、无需注册账号，"
         "安装后即可与人机对弈、复盘分析、整理棋谱。")
add_para(doc,
         "与市面上主流围棋平台不同，本产品全部分析在用户本机完成：棋局不上传、"
         "分析不按年份订阅、不依赖网络质量。对于围棋培训场景——尤其是少儿培训——"
         "这意味着更低的长期成本、更好的稳定性以及更低的隐私风险。")

doc.add_heading("1.3 核心创新点", level=2)
add_table(doc,
          ["创新点", "具体内容", "价值"],
          [
              ["**全本地化 AI 架构**",
               "KataGo 引擎与分析模型随安装包分发，推理在用户 GPU 上完成，全程离线",
               "零服务器成本、零数据上传、断网可用"],
              ["**人类棋力模拟**",
               "接入 KataGo Human SL 模型，提供 20k–9d 共 29 档拟人棋力",
               "AI 不是“碾压”，而是“像人一样陪练”，符合教学节奏"],
              ["**双引擎协同判断**",
               "KataGo 负责胜率、目差与推荐落点；GNU Go 负责死子识别、"
               "数子就绪检查与终局裁判",
               "解决开源 AI 普遍缺失的“对局收尾”问题"],
              ["**一体化研究工作台**",
               "变化树、摆子、标记、备注、SGF 导入导出、草稿恢复集成于同一界面",
               "免去在多个工具间来回切换"],
              ["**本地棋谱资产化**",
               "SQLite 本地棋谱库，支持搜索、标签、集合、回收站与备份恢复",
               "学员个人棋谱沉淀为可管理的资产，而非散落文件"],
          ],
          widths=[3.4, 6.6, 4.6])

doc.add_heading("1.4 项目现状", level=2)
add_table(doc,
          ["维度", "现状"],
          [
              ["产品阶段", "已具备可安装、可完整使用的 Windows x64 产品，非概念原型"],
              ["当前版本", "v1.1.0，2026 年 10 月 14 日发布（GitHub Release）"],
              ["发行渠道", "GitHub 发布安装包；Gitee 同步源码与下载入口"],
              ["代码规模", "前端 Vue/TypeScript 约 1.6 万行；Rust 后端约 4,900 行；"
                          "Tauri 命令接口 19 个"],
              ["测试状态", "JavaScript 测试 48 项通过；Rust 测试 33 项通过、"
                          "2 项真实引擎集成测试默认跳过"],
              ["商业模式", "尚未形成收入（本阶段目标为验证与冷启动）"],
              ["主体状态", "个人独立开发，未注册公司实体"],
          ],
          widths=[3.4, 11.2])

add_note(doc, "说明：测试用例数量来自项目发布说明；代码规模由源码统计得出，"
              "不含第三方依赖与资源文件。")

doc.add_page_break()
doc.add_heading("二、问题与需求", level=1)

doc.add_heading("2.1 围棋学习者的真实困境", level=2)
add_para(doc,
         "围棋是一项“理解比记忆更重要、复盘比下棋更重要”的技能。业余棋手水平提升的核心路径是："
         "对局 → 复盘 → 找出失误 → 针对性练习。但在这条路径上，学习者长期面临四个断层：")

add_table(doc,
          ["断层", "现状问题", "后果"],
          [
              ["**陪练断层**",
               "高水平对手稀缺。找人类高手陪练成本高；用常规 AI 下棋，AI 每一步都是最强手，"
               "学习者被迫“学错误的东西”",
               "学不到适合自己水平的棋，越下越迷茫"],
              ["**复盘断层**",
               "专业复盘依赖教练时间，一堂课覆盖的棋局有限；"
               "自行使用开源工具复盘需要拼装引擎、配置命令行",
               "复盘频率低，错误长期重复"],
              ["**资产与稳定断层**",
               "棋谱散落在不同平台与本地文件，格式不一、缺少检索，无法形成成长档案；"
               "多数在线服务依赖网络与账号，棋院机房断网即中断，部分功能按年订阅",
               "无长期轨迹可看；课堂使用中断、成本随人数上升"],
          ],
          widths=[2.6, 7.0, 5.0])

doc.add_heading("2.2 培训机构的经营痛点", level=2)
add_bullet(doc, "围棋培训多为中小型棋院，IT 预算有限，无力自建服务器或采购企业级软件；",
           bold_prefix="成本敏感——")
add_bullet(doc, "学员多为儿童，账号体系、在线行为与个人信息合规压力大；",
           bold_prefix="合规压力——")
add_bullet(doc, "教学质量高度依赖个别教师，缺少可复用的标准化工具来沉淀教学资产。",
           bold_prefix="依赖人力——")

doc.add_heading("2.3 现有方案的不足", level=2)
add_para(doc,
         "当前市场大致分为三类解决方案，各自存在明显缺口（详见第四章竞品分析）：")
add_numbered(doc, "在线对弈与 AI 复盘平台：功能强，但重度依赖网络与账号，长期使用需持续付费，"
                  "数据托管在平台方。",
             bold_prefix="在线平台——")
add_numbered(doc, "开源 AI 围棋工具：性能先进、免费，但面向技术型用户，需要自行下载模型、"
                  "配置引擎路径、理解命令行参数，普通家长与少儿学员无法独立使用。",
             bold_prefix="开源工具——")
add_numbered(doc, "线下教练与棋院课程：教学效果最好，但时间成本与经济成本最高，"
                  "且无法覆盖课前课后的自主练习。",
             bold_prefix="人力教学——")
add_para(doc,
         "由此可见，市场中缺少的并非“围棋 AI 能力”，而是把这项能力以最低使用门槛交付给"
         "非技术用户的最后一公里。这正是本项目的切入点。", space_before=6)

doc.add_page_break()
doc.add_heading("三、解决方案与产品", level=1)

doc.add_heading("3.1 产品功能全景", level=2)
add_para(doc,
         "时光围棋 v1.1.0 已实现下列功能，均可下载安装包实际验证：")
add_table(doc,
          ["模块", "功能", "状态"],
          [
              ["**人机对局**", "29 档拟人棋力（20k–1k、1d–9d），执黑/执白/猜先，"
                              "中国、日韩、AGA 三种规则，让先与 2–9 子让子，多档用时", "已实现"],
              ["**双人 / 局域网对局**", "同机轮流落子，支持计时与悔棋；局域网创建/扫描房间、"
                                      "手动 IP、房间密码、断线恢复", "已实现"],
              ["**AI 分析**", "黑白胜率、目差、候选落点与变化图、AI 形势预测", "已实现"],
              ["**终局裁判**", "死子识别、数子就绪检查、终局判定、可取消恢复", "已实现"],
              ["**研究工作台与棋谱库**", "变化树、摆子、标记备注、主线调整、草稿恢复、"
                                        "SGF 导入导出；本地保存、搜索标签、集合、备份恢复", "已实现"],
          ],
          widths=[2.6, 9.8, 2.2])

add_para(doc, "另有国际化（中英文切换）与跨平台（macOS / Linux）两项属规划中功能，"
              "不在 v1.1.0 交付范围内。", space_before=2)

doc.add_heading("3.2 技术架构", level=2)
add_para(doc,
         "产品采用“前端展示—原生后端—本地引擎”的三层架构，将浏览器技术栈的开发效率"
         "与原生程序的计算能力与分发能力结合：")
add_table(doc,
          ["层次", "技术选型", "职责"],
          [
              ["表现层", "Vue 3 + TypeScript + Pinia + Vue Router，Canvas 绘制棋盘",
               "棋盘渲染、交互逻辑、规则与计分"],
              ["桥接层", "Tauri 2（Rust），19 个命令接口",
               "进程管理、文件访问、原生能力授权"],
              ["计算层", "KataGo JSON Analysis Engine / GTP；GNU Go",
               "AI 推理、形势估计、终局裁判"],
              ["网络层", "Rust 实现的 TCP 房间服务 + UDP 房间发现",
               "局域网对弈，无中心服务器"],
              ["存储层", "SQLite（rusqlite，bundled）",
               "本地棋谱库与设置持久化"],
          ],
          widths=[2.2, 6.2, 6.2])

add_para(doc,
         "该架构的关键取舍在于：使用 Tauri 而非 Electron，使安装包不携带完整浏览器内核，"
         "在包含近 1.2 GB AI 资源的前提下，安装包体积仍控制在约 1.06 GB；"
         "同时由于计算完全本地化，产品不存在任何服务器侧运行成本。", space_before=6)

doc.add_heading("3.3 关键技术壁垒", level=2)
add_para(doc, "项目在工程层面已沉淀以下不易被简单复制的积累：")
add_bullet(doc, "对 KataGo 运行时的探测与选择逻辑（可执行文件、模型、配置文件、"
                "TensorRT/CUDA 依赖的多级降级），以及在 NVIDIA GPU 环境下的预热与缓存管理；",
           bold_prefix="引擎集成——")
add_bullet(doc, "Human SL 模型与高强度分析模型的分离调度：陪练用拟人模型，"
                "分析用高算力模型，且分析按需触发，避免长期占用 GPU；",
           bold_prefix="双模型调度——")
add_bullet(doc, "将 GNU Go 的死子识别与数子检查转化为可取消、可恢复的异步裁判流程，"
                "补足 KataGo 只输出分数建议、不做形式判定的空白；",
           bold_prefix="裁判闭环——")
add_bullet(doc, "在 NAT 环境下无需服务器的房间发现（UDP 广播）与断线恢复机制，"
                "在保证低延迟的同时把运营成本压到零。",
           bold_prefix="局域网对弈——")

doc.add_heading("3.4 产品演进路线", level=2)
add_table(doc,
          ["阶段", "目标", "关键任务"],
          [
              ["**验证期（当前—6 个月）**",
               "完成从“能跑”到“敢给普通用户装”",
               "模型分档分发、安装包签名、中英双语、干净环境安装验证、"
               "10 家棋院免费试点"],
              ["**产品化期（6–18 个月）**",
               "形成可售卖的标准版与专业版",
               "错题本与训练计划、教师端学员数据看板、账号与授权体系、"
               "官网与支付链路"],
              ["**平台化期（18–36 个月）**",
               "从工具升级为教学平台",
               "题库与段位测评、棋院 SaaS 后台、海外版与多语言、"
               "与培训机构/学校的渠道合作"],
          ],
          widths=[3.6, 4.6, 6.4])

doc.add_page_break()
doc.add_heading("四、市场分析", level=1)

doc.add_heading("4.1 宏观环境（PEST）", level=2)
add_table(doc,
          ["维度", "要点", "对本项目的影响"],
          [
              ["政策", "“双减”后素质教育、体育美育类培训受到鼓励；"
                       "AI 进校园与人工智能教育方向被持续强调 [待核实：具体政策文号与日期]",
               "围棋培训作为非学科素质类目，基本盘稳定；AI+教育是社会价值叙事的有力支撑"],
              ["经济", "家庭在少儿素质教育上的支出具备韧性；"
                       "但家长对“按年订阅”类数字服务的接受度分化 [待核实：相关消费调研数据]",
               "买断制、低门槛定价更容易被家长接受"],
              ["社会", "围棋兼具文化属性与思维训练属性，中产家庭重视程度高；"
                       "围棋人口以少儿为主要增量 [待核实：中国围棋协会或行业机构公开统计]",
               "学员端是增量市场，培训机构是天然的获客渠道"],
              ["技术", "开源围棋 AI（KataGo 等）能力已超越多数职业棋手；"
                       "消费级 GPU 普及率快速提升",
               "核心技术底座免费可用，差异化的空间转移到产品化与场景适配"],
          ],
          widths=[1.8, 6.6, 6.2])

add_note(doc, "「待核实」项需在提交前补齐来源：建议引用中国围棋协会公开数据、"
              "国家体育总局相关规划文件、以及艾瑞/易观等机构的教育消费报告原文链接。"
              "本环境无法访问外网，故不在本文中给出具体数值。")

doc.add_heading("4.2 目标市场与用户画像", level=2)
add_para(doc,
         "综合考虑付费意愿、使用场景与竞品密度，建议采取“以培训机构为渠道、以少儿学员为终端”"
         "的主攻方向，个人自学爱好者作为自然流量切入口。")
add_table(doc,
          ["用户群体", "身份", "核心诉求", "付费意愿", "优先级"],
          [
              ["**少儿学员（及其家长）**", "围棋培训机构在读学员",
               "不伤眼、不联网、能陪练、能复盘、价格一次付清", "高（由家长决策）", "**P0 主攻**"],
              ["**棋院与培训教师**", "围棋教师、机构负责人",
               "课堂上稳定可用、能沉淀学员棋谱、能减轻复盘工作量", "高（批量采购）", "**P0 主攻**"],
              ["自学冲段爱好者", "业余爱好者、大学生",
               "比开源工具更省事，比在线平台更自由、更便宜", "中", "P1"],
              ["海外围棋学习者", "英语/其他语言使用者",
               "同类本地化工具稀缺，对价格不敏感", "中高", "P1（需先完成国际化）"],
          ],
          widths=[3.4, 3.2, 4.0, 2.4, 1.6])

doc.add_heading("4.3 市场规模测算框架", level=2)
add_para(doc,
         "由于公开统计口径难以精确获取，本文采用自下而上的框架进行保守测算，"
         "各变量均需在提交前以公开数据填充：")

add_para(doc, "公式：潜在市场规模 = 围棋培训在读学员数 × 年均软件付费意愿 × 渗透率",
         indent=False, bold=True, space_before=6)

add_table(doc,
          ["变量", "说明", "取值状态"],
          [
              ["在读学员数", "中国常年参加围棋培训的少儿学员规模", "待核实"],
              ["付费意愿", "家长每年愿意为学习类软件支付的金额", "待核实"],
              ["渗透率", "本地化 AI 工具在培训场景中的可达渗透比例", "待核实"],
          ],
          widths=[3.2, 8.2, 3.2])

add_para(doc,
         "值得说明的是，即使按最保守的渗透率估算，只要形成 1,000 家机构的批量授权，"
         "本项目即可跑通“单人团队覆盖全部成本”的现金流模型——这正是纯本地化架构带来的"
         "结构性优势：收入增长不等于成本增长。", space_before=6)

doc.add_heading("4.4 竞品分析", level=2)
add_para(doc,
         "本项目面对的并非空白市场，而是已被在线平台与开源工具占据的成熟领域。"
         "下表如实列出主要竞品的能力与缺口，并说明本项目的差异化位置。")
add_table(doc,
          ["类型 / 代表", "优势", "缺口", "本项目的差异"],
          [
              ["**在线对弈平台**\n（野狐、弈城、OGS 等）",
               "用户基数大、真人对手多、AI 复盘成熟",
               "依赖网络与账号；长期订阅成本；棋谱托管在平台",
               "离线可用、一次付费、数据在本地"],
              ["**开源 AI 工具**\n（Lizzie、KaTrain、Sabaki 等）",
               "免费、功能强大、社区活跃",
               "需自行配置引擎与模型；界面面向技术用户；"
               "缺少面向少儿的教学流程与数据管理",
               "开箱即用；拟人棋力可直接选；棋谱库与研究工作台一体化"],
              ["**在线教学平台**\n（具备作业与题库功能者）",
               "完整教学闭环、紧跟课程体系",
               "价格高、绑定机构、网络依赖强",
               "可作为机构自有平台的补充工具"],
              ["**通用对话式 AI**",
               "门槛极低、上手快",
               "对局能力弱、输赢与规则不可靠、无法承担正式对局与计分",
               "专业规则引擎 + 职业级 AI 引擎"],
          ],
          widths=[3.6, 4.0, 4.0, 3.0])

add_note(doc, "说明：竞品信息基于公开产品认知整理，具体版本、定价与功能细节"
              "需在提交前以官方页面核实并标注日期，避免被评审质疑时效性。")

doc.add_heading("4.5 竞争壁垒与可持续性", level=2)
add_bullet(doc, "引擎集成、裁判闭环、局域网对弈等工程工作均为实际代码积累，"
                "新进入者需要数月以上的同等投入；",
           bold_prefix="工程壁垒——")
add_bullet(doc, "随着试点机构与学员棋谱积累，本地棋谱库与教学数据会成为机构的迁移成本；",
           bold_prefix="数据壁垒——")
add_bullet(doc, "先与头部棋院建立合作，再以渠道方式向下覆盖，"
                "渠道一旦建立具备排他性；",
           bold_prefix="渠道壁垒——")
add_bullet(doc, "纯本地化架构意味着竞争者无法用“补贴服务器成本”的方式发起价格战。",
           bold_prefix="成本结构壁垒——")

doc.add_page_break()
doc.add_heading("五、商业模式", level=1)

doc.add_heading("5.1 价值主张与盈利模式", level=2)
add_para(doc,
         "产品当前不具备收入，本章为设计中的商业模式，尚未经过市场验证。"
         "整体采用“个人买断 + 机构授权”的双轨结构：B 端提供现金流，C 端提供口碑与传播。")
add_table(doc,
          ["产品线", "目标客户", "定价策略", "交付形态", "作用"],
          [
              ["**教育版**", "棋院、培训机构教师",
               "按教室/机构授权，含 1 年更新",
               "Windows 桌面端 + 学员数据看板 + 批量部署",
               "核心现金流来源"],
              ["**个人版（免费）**", "个人学员、爱好者",
               "免费",
               "人机对局、基础分析、棋谱库",
               "获客与口碑入口"],
              ["**个人版 Pro**", "进阶自学用户",
               "一次性买断",
               "深度分析、错题本、训练计划、多设备同步",
               "个人付费转化"],
              ["**海外版**", "英语及其他语言用户",
               "一次性买断，定价略高于国内",
               "完成国际化后的同款产品",
               "增量市场"],
          ],
          widths=[2.6, 3.4, 3.0, 3.8, 2.2])

add_para(doc,
         "选择买断制而非订阅制，理由有三：本地化产品没有持续的服务成本，"
         "按年收费缺乏正当性；家长对“一次性付费的软件”接受度显著高于“按年订阅”；"
         "机构采购议价时，买断价的决策链条远短于订阅审批。", space_before=6)

doc.add_heading("5.2 成本结构", level=2)
add_table(doc,
          ["成本项", "性质", "说明"],
          [
              ["研发人力", "主要成本", "个人开发阶段为时间投入；组建团队后为最大支出项"],
              ["代码签名证书", "固定成本", "解决安装包“发布者未知”的信任问题，属必需投入"],
              ["模型与资源分发", "变动成本", "通过对象存储或 CDN 分发 AI 资源，成本随下载量增长"],
              ["市场与渠道", "变动成本", "棋院地推、教师社群、展会"],
              ["服务器", "极低", "仅需官网、下载与授权校验，无推理服务器"],
          ],
          widths=[3.2, 2.6, 8.8])

add_para(doc,
         "与传统在线教育产品相比，本项目最大的财务特征是“收入增长不等于成本线性增长”："
         "AI 推理在用户本机完成，边际服务成本接近于零，因此毛利率在高规模下趋近于 100%。",
         space_before=6)

doc.add_heading("5.3 获客路径", level=2)
add_numbered(doc, "在二三线城市选取 10 家棋院免费部署，换取真实使用反馈、"
                  "公开评测与首批案例；",
             bold_prefix="免费试点——")
add_numbered(doc, "对接围棋教师社群与赛事，以教研工具的身份切入，"
                  "而非与教练争夺角色；",
             bold_prefix="教师社群——")
add_numbered(doc, "开源社区已积累的 GitHub/Gitee 渠道继续运营，"
                  "以技术内容吸引高阶爱好者，转化为自助付费与推荐；",
             bold_prefix="开源社区——")
add_numbered(doc, "将“本地化、无隐私风险”作为短视频与家长社群的核心传播点。",
             bold_prefix="家长口碑——")

doc.add_heading("5.4 里程碑与收入路径", level=2)
add_table(doc,
          ["时间", "产品里程碑", "商业里程碑"],
          [
              ["0–6 个月", "完成签名、分档分发、双语、干净环境验证",
               "10 家试点机构；不追求收入"],
              ["6–18 个月", "教育版发布，学员数据看板，授权体系上线",
               "首批付费机构；跑通单机构交付流程"],
              ["18–36 个月", "题库与段位测评，海外版发布",
               "形成可复制的区域代理与渠道体系"],
          ],
          widths=[2.8, 6.4, 5.4])

doc.add_page_break()
doc.add_heading("六、团队与执行", level=1)

doc.add_heading("6.1 当前团队构成", level=2)
add_para(doc,
         "项目当前由个人独立完成，覆盖产品设计、前端（Vue 3 / TypeScript，约 1.6 万行）、"
         "后端（Rust，约 4,900 行）、AI 引擎集成、桌面打包发布与测试的完整链条。"
         "已连续完成 v1.0.0、v1.1.0 两个正式版本的发布与迭代。")
add_note(doc, "待补充：姓名、院校、专业、年级、联系方式、指导老师。"
              "如已获得奖项、专利、软著或在开源社区获得关注（Star/Fork 数），"
              "请在本节补充，这些在评审中权重很高。")

doc.add_heading("6.2 能力缺口与补齐计划", level=2)
add_table(doc,
          ["缺口", "影响", "补齐方式", "优先级"],
          [
              ["**商业化与渠道**", "有产品无销售，是最关键的短板",
               "引入具备教育行业销售经验的合伙人，或与区域代理商合作", "**最高**"],
              ["**法律与合规**", "开源许可与第三方再分发依据未完全确认，属发行风险",
               "聘请律师完成许可审计，明确根目录 LICENSE 与第三方声明", "**最高**"],
              ["**UI/UX 与幼龄适配**", "界面偏成人向，少儿使用门槛可进一步降低",
               "引入交互设计顾问，开展儿童可用性测试", "高"],
              ["**测试与质量保障**", "缺少端到端自动化测试与 CI 流程",
               "建立 GitHub Actions：前端构建、Rust 测试、安装验证", "高"],
              ["**内容与教研**", "缺少题库、课程体系与段位标准",
               "与围棋教师共建教研内容，避免自行编写专业内容", "中"],
          ],
          widths=[3.0, 4.6, 5.6, 1.4])

doc.add_heading("6.3 阶段性目标（建议按 SMARTER 原则设指标）", level=2)
add_table(doc,
          ["时间节点", "量化目标（建议值，需据实调整）"],
          [
              ["第 6 个月", "完成 1 个正式签名版本；10 家棋院试点；"
                           "累计安装 ≥ 500 台；建立 CI 流程"],
              ["第 12 个月", "教育版上线；试点机构转付费 ≥ 20%；"
                            "完成许可合规审计；发布英文版"],
              ["第 24 个月", "授权机构 ≥ 200 家；建立区域代理；"
                            "形成可复制的标准交付与培训手册"],
          ],
          widths=[3.0, 11.6])

doc.add_page_break()
doc.add_heading("七、社会价值", level=1)
add_bullet(doc, "围棋是中华传统文化的重要载体；以现代 AI 技术降低其学习门槛，"
                "有助于传统文化在青少年中的普及，服务于文化自信的树立；",
           bold_prefix="文化传承——")
add_bullet(doc, "在推动人工智能教育普及的背景下，本产品让学员在日常训练中直接体验"
                "“与 AI 协作”的学习方式，同时不增加家庭经济负担；",
           bold_prefix="科技普惠——")
add_bullet(doc, "全部数据留在本地，不采集未成年人上网行为、不上传棋局，"
                "在同等功能的产品中隐私风险最低；",
           bold_prefix="隐私保护——")
add_bullet(doc, "以离线化、低成本的工具支持中小型棋院，降低教育资源的机构间差距；",
           bold_prefix="共同富裕——")
add_bullet(doc, "项目以开源社区资源（KataGo、GNU Go、Tauri、Vue 等）为技术底座，"
                "产品成熟后可将教学交互层以开源方式回馈社区。",
           bold_prefix="开源回馈——")

doc.add_heading("八、风险与应对", level=1)
add_para(doc,
         "本章如实披露项目当前的主要风险。评审最关注的往往不是“有没有风险”，"
         "而是“是否知道自己的风险在哪里”。")

add_table(doc,
          ["风险", "具体描述", "等级", "应对措施"],
          [
              ["**分发体积风险**",
               "完整安装包约 1.06 GB，其中 KataGo/DLL/模型占约 1.16 GB；"
               "下载与安装门槛高，对首次体验极不友好",
               "**高**",
               "按硬件分档分发：无 GPU 精简包、NVIDIA 优化包、CPU 基础包；"
               "模型按需下载；提供分卷与断点续传"],
              ["**硬件门槛风险**",
               "TensorRT 资源目前仅覆盖 sm89，仅重点验证了 RTX 4060 Laptop；"
               "其他 GPU 与无独显设备未经验证",
               "**高**",
               "补充 CPU 后端与更广的 CUDA 架构支持；在官网明确设备要求与自检工具；"
               "建兼容性矩阵与用户反馈收集通道"],
              ["**许可合规风险**",
               "TensorRT/CUDA、Visual C++ 运行库的再分发依据、"
               "图片与模型的分发条件尚未全部确认，项目尚无根目录 LICENSE",
               "**高**",
               "发行前完成逐项许可审计并出具第三方声明；"
               "必要时改用可自由分发的其他推理后端（如 OpenCL 或纯 CPU 后端）"],
              ["**信任与安全问题**",
               "安装包未做数字签名，Windows 会提示“发布者未知”，"
               "冷启动阶段直接影响转化",
               "中高",
               "购置代码签名证书（EV 证书可缩短 SmartScreen 预警期）；"
               "提供 SHA-256 校验与开源代码供审计"],
              ["**收入被上游侵蚀风险**",
               "核心引擎为开源项目，同类工具或大厂可能提供更完善的免费方案",
               "中",
               "差异化落在教育场景与数据管理上，而非引擎能力；"
               "以机构渠道与本地数据形成迁移成本"],
              ["**主创单点风险**",
               "个人独立开发，缺少法律、商业、渠道角色，"
               "项目连续性依赖单人",
               "**高**",
               "尽快组建 3–5 人核心团队并明确分工与股权安排；"
               "关键模块补充文档，降低知识单点"],
              ["**技术准确性风险**",
               "KataGo 的 final_score 在未定型局面下为搜索估算，"
               "中国规则双活局面曾复现 1 目误差；GNU Go 不支持 AGA 规则",
               "中",
               "界面已标注为“计分建议”，不以 AI 结果替代人工裁定；"
               "在教学中明确该边界，避免误导学员"],
              ["**主体合规风险**",
               "尚未注册公司，无法承接机构采购合同与开票",
               "中",
               "商业化启动前完成公司注册，明确经营范围含软件开发与教育咨询服务"],
              ["**市场验证风险**",
               "目前无任何真实用户数据与收入，市场判断尚属假设",
               "**高**",
               "以 10 家试点机构换取真实数据，用反馈修正产品与定价；"
               "立项书中所有市场数字在验证后替换为实测值"],
          ],
          widths=[2.8, 5.4, 1.3, 5.1])

doc.add_page_break()
doc.add_heading("九、结论", level=1)
add_para(doc,
         "时光围棋已经越过了绝大多数学生创业项目最危险的一关：它不是一个 PPT，"
         "而是一个真实可安装、可对弈、可复盘的完整产品。在围棋 AI 能力被开源社区"
         "免费提供的今天，单纯“做出一个 AI 围棋”已无稀缺性；本项目真正的价值在于"
         "把这项能力以最低门槛交付给最需要它、却最不具备技术能力的那群人——"
         "围棋培训机构的教师与少儿学员。")
add_para(doc,
         "当前项目的短板同样清晰：缺乏商业验证、缺乏团队分工、分发体积与硬件门槛偏高、"
         "许可合规尚未闭环、开发者信任尚未建立。这些都不是产品逻辑问题，"
         "而是从“作品”走向“生意”必须补的功课，也正是需要外部资源投入的地方。")
add_para(doc,
         "下一步的行动计划已明确：以 10 家棋院试点验证付费意愿，以代码签名与分档分发降低"
         "体验门槛，以许可审计与公司注册完成合规闭环。我们相信，"
         "一款不联网、不泄题、把数据留在学员自己电脑里的 AI 围棋教练，"
         "既能赚钱，也值得被认真做出来。")

drop_trailing_gap(doc)

hr(doc)
add_note(doc,
         "附：本文档数据来源说明\n"
         "1. 产品功能、版本号、测试用例数与发行状态：来自项目 README、RELEASE_NOTES 与代码统计。\n"
         "2. 安装包体积与资源构成：由 src-tauri/resources 目录实测（KataGo 960.1 MB、"
         "katago-estimate 109.0 MB、katago-human 94.5 MB、GNU Go 9.8 MB），"
         "安装包 1.06 GB 来自 v1.0.0 发布说明。\n"
         "3. 代码规模：前端 src/ 下 .vue/.ts 共 15,995 行；Rust src-tauri/src 共 4,925 行；"
         "Tauri 命令接口 19 个（由源码统计）。\n"
         "4. 市场数据：本项目编写环境无法访问外网，所有市场口径均标注「待核实」，"
         "提交前须以官方或权威机构原文链接替换。\n"
         "5. 竞品信息：基于公开产品认知整理，需以官方页面核实并标注日期。")

out = r"L:\WebLearn\ai-go-desktop\docs\时光围棋ShiGuang-Go_创业立项书.docx"
doc.save(out)
print("saved:", out)
