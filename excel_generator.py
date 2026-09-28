import os
import io
import re
import zipfile
from typing import Dict, Any, List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates_excel")
TEMPLATE_INSTRUCTOR = os.path.join(TEMPLATES_DIR, "template_instructor.xlsx")
TEMPLATE_COURSE = os.path.join(TEMPLATES_DIR, "template_course.xlsx")


def escape_xml(s: Any) -> str:
    """XML 특수문자 이스케이프"""
    return (
        str(s if s is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def update_chart_xml(xml_content: str, categories: List[Any], values: List[Any], is_ref: bool = False, is_float: bool = False) -> str:
    """
    차트 XML 내의 카테고리(X축) 및 값(Y축) 데이터를 원본 서식 손실 없이 갱신.
    - is_ref: strRef / numRef 형식 (Chart 0, Chart 1)
    - not is_ref: strLit / numLit 형식 (Chart 2 ~ Chart 5)
    """
    # 1. Categories (X축)
    pts_cat = "".join([f'<c:pt idx="{i}"><c:v>{escape_xml(c)}</c:v></c:pt>' for i, c in enumerate(categories)])
    if is_ref:
        new_cat = f'<c:strCache><c:ptCount val="{len(categories)}"/>{pts_cat}</c:strCache>'
        xml_content = re.sub(r'(<c:f>.*?</c:f>)\s*<c:strCache>.*?</c:strCache>', rf'\g<1>{new_cat}', xml_content, flags=re.DOTALL)
        xml_content = re.sub(r'(<c16:filteredLitCache>)\s*<c:strCache>.*?</c:strCache>', rf'\g<1>{new_cat}', xml_content, flags=re.DOTALL)
    else:
        new_cat = f'<c:strLit><c:ptCount val="{len(categories)}"/>{pts_cat}</c:strLit>'
        xml_content = re.sub(r'<c:strLit>.*?</c:strLit>', new_cat, xml_content, flags=re.DOTALL)

    # 2. Values (Y축 수치)
    if is_float:
        pts_val = "".join([f'<c:pt idx="{i}"><c:v>{float(v):.1f}</c:v></c:pt>' for i, v in enumerate(values)])
        fmt = "0.0"
    else:
        pts_val = "".join([f'<c:pt idx="{i}"><c:v>{int(round(float(v)))}</c:v></c:pt>' for i, v in enumerate(values)])
        fmt = "General"

    if is_ref:
        new_val = f'<c:numCache><c:formatCode>{fmt}</c:formatCode><c:ptCount val="{len(values)}"/>{pts_val}</c:numCache>'
        xml_content = re.sub(r'(<c:f>.*?</c:f>)\s*<c:numCache>.*?</c:numCache>', rf'\g<1>{new_val}', xml_content, flags=re.DOTALL)
        xml_content = re.sub(r'(<c16:filteredLitCache>)\s*<c:numCache>.*?</c:numCache>', rf'\g<1>{new_val}', xml_content, flags=re.DOTALL)
    else:
        new_val = f'<c:numLit><c:formatCode>{fmt}</c:formatCode><c:ptCount val="{len(values)}"/>{pts_val}</c:numLit>'
        xml_content = re.sub(r'<c:numLit>.*?</c:numLit>', new_val, xml_content, flags=re.DOTALL)

    return xml_content


def set_cell_value(sheet_xml: str, coord: str, value: Any, is_string: bool = False, style_id: Optional[int] = None) -> str:
    """
    OpenXML sheet.xml 내의 특정 셀 좌표(예: B5, F10)의 값을 안전하게 치환/입력.
    style_id가 제공되면 s 속성을 해당 스타일 ID로 갱신.
    """
    pattern = rf'(<c\s+r="{coord}"[^>]*?)(?:/>|>(.*?)</c>)'
    m = re.search(pattern, sheet_xml, flags=re.DOTALL)

    if is_string:
        val_str = escape_xml(value)
        new_content = f'<is><t>{val_str}</t></is>'
        if m:
            open_tag = m.group(1)
            open_tag = re.sub(r'\s+t="[^"]*"', '', open_tag)
            if style_id is not None:
                if ' s="' in open_tag:
                    open_tag = re.sub(r' s="[^"]*"', f' s="{style_id}"', open_tag)
                else:
                    open_tag += f' s="{style_id}"'
            open_tag += ' t="inlineStr">'
            return sheet_xml[:m.start()] + open_tag + new_content + '</c>' + sheet_xml[m.end():]
        else:
            row_num = re.search(r'(\d+)', coord).group(1)
            row_pattern = rf'(<row\s+r="{row_num}"[^>]*>)'
            rm = re.search(row_pattern, sheet_xml, flags=re.DOTALL)
            if rm:
                s_attr = f' s="{style_id}"' if style_id is not None else ''
                cell_xml = f'<c r="{coord}"{s_attr} t="inlineStr">{new_content}</c>'
                return sheet_xml[:rm.end()] + cell_xml + sheet_xml[rm.end():]
    else:
        if isinstance(value, (int, float)):
            val_num = f"{float(value):.2f}".rstrip('0').rstrip('.')
            if val_num == "":
                val_num = "0"
        else:
            val_num = str(value if value is not None else "0")
        new_content = f'<v>{val_num}</v>'
        if m:
            open_tag = m.group(1)
            open_tag = re.sub(r'\s+t="[^"]*"', '', open_tag)
            if style_id is not None:
                if ' s="' in open_tag:
                    open_tag = re.sub(r' s="[^"]*"', f' s="{style_id}"', open_tag)
                else:
                    open_tag += f' s="{style_id}"'
            open_tag += '>'
            return sheet_xml[:m.start()] + open_tag + new_content + '</c>' + sheet_xml[m.end():]
        else:
            row_num = re.search(r'(\d+)', coord).group(1)
            row_pattern = rf'(<row\s+r="{row_num}"[^>]*>)'
            rm = re.search(row_pattern, sheet_xml, flags=re.DOTALL)
            if rm:
                s_attr = f' s="{style_id}"' if style_id is not None else ''
                cell_xml = f'<c r="{coord}"{s_attr}>{new_content}</c>'
                return sheet_xml[:rm.end()] + cell_xml + sheet_xml[rm.end():]

    return sheet_xml


class ExcelGenerator:
    def __init__(self):
        pass

    def generate(self, report_data: Dict[str, Any]) -> io.BytesIO:
        """
        사용자 샘플 엑셀 파일(template_instructor.xlsx / template_course.xlsx)의
        Office 차트 6개, 서식, 컬러, 스타일을 100% 무손실로 보존하여
        마이크로소프트 엑셀에서 완벽하게 열리는 동일 양식 엑셀 파일 생성.
        """
        mode = report_data.get("mode", "instructor")
        template_path = TEMPLATE_INSTRUCTOR if mode == "instructor" else TEMPLATE_COURSE
        if not os.path.exists(template_path):
            template_path = TEMPLATE_INSTRUCTOR

        sheets = report_data.get("sheets", [])
        if not sheets:
            with open(template_path, "rb") as f:
                return io.BytesIO(f.read())

        zin = zipfile.ZipFile(template_path, "r")
        files = {name: zin.read(name) for name in zin.namelist()}
        zin.close()

        # 템플릿의 1번 시트 원형 추출
        base_sheet_xml = files["xl/worksheets/sheet1.xml"].decode("utf-8")
        base_sheet_rels = files["xl/worksheets/_rels/sheet1.xml.rels"].decode("utf-8")
        base_drawing_xml = files["xl/drawings/drawing1.xml"].decode("utf-8")
        base_drawing_rels = files["xl/drawings/_rels/drawing1.xml.rels"].decode("utf-8")

        # 1회차(막대) 및 누적회차(꺾은선) 차트 원형 템플릿 추출
        chart_bar_sat = files["xl/charts/chart1.xml"].decode("utf-8")
        chart_bar_nps = files["xl/charts/chart2.xml"].decode("utf-8")
        chart_line_sat = files["xl/charts/chart7.xml"].decode("utf-8")
        chart_line_nps = files["xl/charts/chart8.xml"].decode("utf-8")
        chart_complaints = files["xl/charts/chart3.xml"].decode("utf-8")
        chart_preferred = files["xl/charts/chart4.xml"].decode("utf-8")
        chart_positions = files["xl/charts/chart5.xml"].decode("utf-8")
        chart_motives = files["xl/charts/chart6.xml"].decode("utf-8")

        # 기존 시트/드로잉/차트 파일 정리
        keys_to_remove = [
            k for k in files
            if k.startswith("xl/worksheets/") or k.startswith("xl/drawings/") or k.startswith("xl/charts/")
        ]
        for k in keys_to_remove:
            del files[k]

        sheet_entries = []
        wb_rels_entries = []
        used_titles = set()

        for s_idx, sdata in enumerate(sheets):
            sheet_num = s_idx + 1
            drawing_num = s_idx + 1
            start_chart_num = s_idx * 6 + 1

            # 1. 시트 내용 패치 (헤더, 점수, 커리큘럼, 주관식의견)
            s_xml = base_sheet_xml
            s_xml = set_cell_value(s_xml, "B5", sdata.get("course_name", ""), is_string=True)
            s_xml = set_cell_value(s_xml, "G5", sdata.get("display_period", ""), is_string=True)
            s_xml = set_cell_value(s_xml, "I5", sdata.get("respondent_count", 0), is_string=False)

            instructors = sdata.get("instructors", [])
            extra_rows = (len(instructors) - 1) * 2 if (mode == "course" and len(instructors) > 1) else 0

            d_xml = base_drawing_xml

            if extra_rows > 0:
                # 1. 12행 이상의 모든 row 및 cell 좌표 시프트 (+ extra_rows)
                def shift_cell_coord(m):
                    col = m.group(1)
                    r_num = int(m.group(2))
                    if r_num >= 12:
                        return f'<c r="{col}{r_num + extra_rows}"'
                    return m.group(0)

                def shift_row_num(m):
                    r_num = int(m.group(1))
                    if r_num >= 12:
                        return f'<row r="{r_num + extra_rows}"'
                    return m.group(0)

                def shift_merge_cell(m):
                    c1, r1, c2, r2 = m.groups()
                    r1_num, r2_num = int(r1), int(r2)
                    new_r1 = r1_num + extra_rows if r1_num >= 12 else r1_num
                    new_r2 = r2_num + extra_rows if r2_num >= 12 else r2_num
                    return f'<mergeCell ref="{c1}{new_r1}:{c2}{new_r2}"/>'

                s_xml = re.sub(r'<c\s+r="([A-Z]+)(\d+)"', shift_cell_coord, s_xml)
                s_xml = re.sub(r'<row\s+r="(\d+)"', shift_row_num, s_xml)
                s_xml = re.sub(r'<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/>', shift_merge_cell, s_xml)

                # 2. 추가 강사 행 (12, 13, 14, 15 ...) 생성
                new_rows_xml = []
                new_merge_cells = []
                for k in range(1, len(instructors)):
                    r_top = 10 + k * 2
                    r_bot = 11 + k * 2
                    inst_k = instructors[k]
                    cur_k = inst_k.get("current", {})
                    cum_k = inst_k.get("cumulative", {})
                    name_str = escape_xml(inst_k.get("instructor_name", ""))
                    curr_str = escape_xml(inst_k.get("curriculum", ""))
                    hours_val = escape_xml(inst_k.get("hours", ""))

                    r_top_xml = (
                        f'<row r="{r_top}" spans="2:9" ht="67.5" customHeight="1" x14ac:dyDescent="0.3">'
                        f'<c r="B{r_top}" s="10" t="inlineStr"><is><t>{name_str}</t></is></c>'
                        f'<c r="C{r_top}" s="40" t="inlineStr"><is><t>{curr_str}</t></is></c>'
                        f'<c r="D{r_top}" s="41"/>'
                        f'<c r="E{r_top}" s="11" t="inlineStr"><is><t>이번&#10;차수</t></is></c>'
                        f'<c r="F{r_top}" s="12"><v>{float(cur_k.get("teaching_expertise", 0)):.1f}</v></c>'
                        f'<c r="G{r_top}" s="12"><v>{float(cur_k.get("delivery_skill", 0)):.1f}</v></c>'
                        f'<c r="H{r_top}" s="12"><v>{float(cur_k.get("practical_use", 0)):.1f}</v></c>'
                        f'<c r="I{r_top}" s="13"><v>{float(cur_k.get("textbook_quality", 0)):.1f}</v></c>'
                        f'</row>'
                    )
                    r_bot_xml = (
                        f'<row r="{r_bot}" spans="2:9" ht="67.5" customHeight="1" x14ac:dyDescent="0.3">'
                        f'<c r="B{r_bot}" s="14" t="inlineStr"><is><t>{hours_val}</t></is></c>'
                        f'<c r="C{r_bot}" s="42"/>'
                        f'<c r="D{r_bot}" s="43"/>'
                        f'<c r="E{r_bot}" s="11" t="inlineStr"><is><t>누적&#10;평균</t></is></c>'
                        f'<c r="F{r_bot}" s="12"><v>{float(cum_k.get("teaching_expertise", 0)):.1f}</v></c>'
                        f'<c r="G{r_bot}" s="12"><v>{float(cum_k.get("delivery_skill", 0)):.1f}</v></c>'
                        f'<c r="H{r_bot}" s="12"><v>{float(cum_k.get("practical_use", 0)):.1f}</v></c>'
                        f'<c r="I{r_bot}" s="13"><v>{float(cum_k.get("textbook_quality", 0)):.1f}</v></c>'
                        f'</row>'
                    )
                    new_rows_xml.append(r_top_xml + r_bot_xml)
                    new_merge_cells.append(f'<mergeCell ref="C{r_top}:D{r_bot}"/>')

                # 11행 끝난 직후 삽입
                s_xml = re.sub(r'(<row\s+r="11"[^>]*>.*?</row>)', rf'\g<1>{"".join(new_rows_xml)}', s_xml, flags=re.DOTALL)

                # mergeCells count 증가 및 추가
                if new_merge_cells:
                    def add_merge_cells(m):
                        cnt = int(m.group(1)) + len(new_merge_cells)
                        return f'<mergeCells count="{cnt}">' + "".join(new_merge_cells)
                    s_xml = re.sub(r'<mergeCells\s+count="(\d+)">', add_merge_cells, s_xml)

                # drawing1.xml 차트 앵커 시프트
                def shift_chart_row(m):
                    r_num = int(m.group(1))
                    if r_num >= 11:
                        return f'<xdr:row>{r_num + extra_rows}</xdr:row>'
                    return m.group(0)
                d_xml = re.sub(r'<xdr:row>(\d+)</xdr:row>', shift_chart_row, d_xml)

            if instructors:
                inst0 = instructors[0]
                s_xml = set_cell_value(s_xml, "B10", inst0.get("instructor_name", ""), is_string=True)
                s_xml = set_cell_value(s_xml, "C10", inst0.get("curriculum", ""), is_string=True)
                s_xml = set_cell_value(s_xml, "B11", inst0.get("hours", ""), is_string=True)

                cur = inst0.get("current", {})
                cum = inst0.get("cumulative", {})
                s_xml = set_cell_value(s_xml, "F10", cur.get("teaching_expertise", 0.0), is_string=False)
                s_xml = set_cell_value(s_xml, "G10", cur.get("delivery_skill", 0.0), is_string=False)
                s_xml = set_cell_value(s_xml, "H10", cur.get("practical_use", 0.0), is_string=False)
                s_xml = set_cell_value(s_xml, "I10", cur.get("textbook_quality", 0.0), is_string=False)

                s_xml = set_cell_value(s_xml, "F11", cum.get("teaching_expertise", 0.0), is_string=False)
                s_xml = set_cell_value(s_xml, "G11", cum.get("delivery_skill", 0.0), is_string=False)
                s_xml = set_cell_value(s_xml, "H11", cum.get("practical_use", 0.0), is_string=False)
                s_xml = set_cell_value(s_xml, "I11", cum.get("textbook_quality", 0.0), is_string=False)

            comments = sdata.get("comments", {})
            if mode == "instructor":
                inst_feedbacks = comments.get("instructor_feedback", [])
                content_feedbacks = comments.get("content_feedback", [])
                rec_feedbacks = comments.get("recommend_feedback", [])
                inst_sents = comments.get("instructor_sentiment", [])
                content_sents = comments.get("content_sentiment", [])
                rec_sents = comments.get("recommend_sentiment", [])

                def get_style_id(sent: str) -> int:
                    if sent in ("중립", "보완"):
                        return 39
                    elif sent == "부정":
                        return 40
                    return 20  # 긍정

                for i in range(4):
                    i_text = inst_feedbacks[i] if i < len(inst_feedbacks) else ""
                    i_sent = inst_sents[i] if i < len(inst_sents) else "긍정"
                    s_xml = set_cell_value(s_xml, f"E{61+i}", i_text, is_string=True)
                    if i_text:
                        s_xml = set_cell_value(s_xml, f"D{61+i}", i_sent, is_string=True, style_id=get_style_id(i_sent))
                    else:
                        s_xml = set_cell_value(s_xml, f"D{61+i}", "", is_string=True, style_id=20)

                    c_text = content_feedbacks[i] if i < len(content_feedbacks) else ""
                    c_sent = content_sents[i] if i < len(content_sents) else "긍정"
                    s_xml = set_cell_value(s_xml, f"E{65+i}", c_text, is_string=True)
                    if c_text:
                        s_xml = set_cell_value(s_xml, f"D{65+i}", c_sent, is_string=True, style_id=get_style_id(c_sent))
                    else:
                        s_xml = set_cell_value(s_xml, f"D{65+i}", "", is_string=True, style_id=20)

                    r_text = rec_feedbacks[i] if i < len(rec_feedbacks) else ""
                    r_sent = rec_sents[i] if i < len(rec_sents) else "긍정"
                    s_xml = set_cell_value(s_xml, f"E{69+i}", r_text, is_string=True)
                    if r_text:
                        s_xml = set_cell_value(s_xml, f"D{69+i}", r_sent, is_string=True, style_id=get_style_id(r_sent))
                    else:
                        s_xml = set_cell_value(s_xml, f"D{69+i}", "", is_string=True, style_id=20)
            else:
                inst_feedbacks = comments.get("instructor_feedback", [])
                content_feedbacks = comments.get("content_feedback", [])
                oper_feedbacks = comments.get("operation_feedback", [])
                rec_feedbacks = comments.get("recommend_feedback", [])
                add_feedbacks = comments.get("additional_courses", [])
                s_xml = set_cell_value(s_xml, f"E{61 + extra_rows}", inst_feedbacks[0] if len(inst_feedbacks) > 0 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{62 + extra_rows}", inst_feedbacks[1] if len(inst_feedbacks) > 1 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{63 + extra_rows}", content_feedbacks[0] if len(content_feedbacks) > 0 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{64 + extra_rows}", oper_feedbacks[0] if len(oper_feedbacks) > 0 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{65 + extra_rows}", rec_feedbacks[0] if len(rec_feedbacks) > 0 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{66 + extra_rows}", rec_feedbacks[1] if len(rec_feedbacks) > 1 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{67 + extra_rows}", rec_feedbacks[2] if len(rec_feedbacks) > 2 else "", is_string=True)
                s_xml = set_cell_value(s_xml, f"E{68 + extra_rows}", add_feedbacks[0] if len(add_feedbacks) > 0 else "", is_string=True)

            files[f"xl/worksheets/sheet{sheet_num}.xml"] = s_xml.encode("utf-8")

            # 2. Sheet rels -> drawing
            s_rels = base_sheet_rels.replace("drawing1.xml", f"drawing{drawing_num}.xml")
            files[f"xl/worksheets/_rels/sheet{sheet_num}.xml.rels"] = s_rels.encode("utf-8")

            # 3. Drawing XML
            files[f"xl/drawings/drawing{drawing_num}.xml"] = d_xml.encode("utf-8")

            # 4. Drawing rels -> charts
            d_rels = base_drawing_rels
            for c_idx in range(6):
                orig_target = f"../charts/chart{c_idx+1}.xml"
                new_target = f"../charts/chart{start_chart_num + c_idx}.xml"
                d_rels = d_rels.replace(orig_target, new_target)
            files[f"xl/drawings/_rels/drawing{drawing_num}.xml.rels"] = d_rels.encode("utf-8")

            # 5. 6개 차트 데이터 주입 (1회차는 막대, 2회차 이상 누적 시 꺾은선으로 자동 전환)
            charts_data = sdata.get("charts", {})
            c0_data = charts_data.get("chart0_satisfaction_trend", {})
            c1_data = charts_data.get("chart1_nps_trend", {})

            cats0 = c0_data.get("categories", [])
            cats1 = c1_data.get("categories", [])

            # 교육과정내용 만족도 및 추천지수: 누적(2개 이상)이면 lineChart(꺾은선), 1개이면 barChart(막대)
            c0_template = chart_line_sat if len(cats0) > 1 else chart_bar_sat
            c1_template = chart_line_nps if len(cats1) > 1 else chart_bar_nps

            chart_defs = [
                (c0_template, c0_data, True, True),
                (c1_template, c1_data, True, True),
                (chart_complaints, charts_data.get("chart2_complaints", {}), False, False),
                (chart_preferred, charts_data.get("chart3_preferred_format", {}), False, False),
                (chart_positions, charts_data.get("chart4_positions", {}), False, False),
                (chart_motives, charts_data.get("chart5_motives", {}), False, False),
            ]

            for c_idx, (t_xml, c_data, is_ref, is_float) in enumerate(chart_defs):
                c_xml = t_xml
                cats = c_data.get("categories", [])
                vals = c_data.get("values", [])
                if cats and vals:
                    c_xml = update_chart_xml(c_xml, cats, vals, is_ref=is_ref, is_float=is_float)
                files[f"xl/charts/chart{start_chart_num + c_idx}.xml"] = c_xml.encode("utf-8")

            # 시트명 생성 및 중복 방지
            raw_title = sdata.get("sheet_title", f"{sheet_num}차")
            clean_title = re.sub(r'[\/\\?*\[\]:]', '_', raw_title)[:30]
            if clean_title in used_titles:
                clean_title = f"{clean_title}_{sheet_num}"[:30]
            used_titles.add(clean_title)

            sheet_entries.append(f'<sheet name="{escape_xml(clean_title)}" sheetId="{sheet_num}" r:id="rId{sheet_num}"/>')
            wb_rels_entries.append(
                f'<Relationship Id="rId{sheet_num}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{sheet_num}.xml"/>'
            )

        # 6. xl/workbook.xml 갱신
        wb_xml = files["xl/workbook.xml"].decode("utf-8")
        wb_xml = re.sub(r"<sheets>.*?</sheets>", f"<sheets>{''.join(sheet_entries)}</sheets>", wb_xml, flags=re.DOTALL)
        wb_xml = re.sub(r"<definedNames>.*?</definedNames>", "", wb_xml, flags=re.DOTALL)
        files["xl/workbook.xml"] = wb_xml.encode("utf-8")

        # 7. xl/_rels/workbook.xml.rels 갱신
        wb_rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
        other_rels = [
            m.group(0) for m in re.finditer(r"<Relationship\s+[^>]*/>", wb_rels)
            if "relationships/worksheet" not in m.group(0)
        ]
        all_wb_rels = "".join(other_rels) + "".join(wb_rels_entries)
        wb_rels = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{all_wb_rels}</Relationships>'
        files["xl/_rels/workbook.xml.rels"] = wb_rels.encode("utf-8")

        # 8. [Content_Types].xml 갱신
        ct_xml = files["[Content_Types].xml"].decode("utf-8")
        ct_xml = re.sub(r'<Override\s+PartName="/xl/(worksheets|drawings|charts)/[^>]*/>', "", ct_xml)
        new_overrides = []
        for s_idx in range(len(sheets)):
            sheet_num = s_idx + 1
            new_overrides.append(f'<Override PartName="/xl/worksheets/sheet{sheet_num}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
            new_overrides.append(f'<Override PartName="/xl/drawings/drawing{sheet_num}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>')
            for c in range(1, 7):
                c_num = s_idx * 6 + c
                new_overrides.append(f'<Override PartName="/xl/charts/chart{c_num}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>')
        ct_xml = ct_xml.replace("</Types>", "".join(new_overrides) + "</Types>")
        files["[Content_Types].xml"] = ct_xml.encode("utf-8")

        # 9. 무손실 ZIP 패키징
        out_buf = io.BytesIO()
        zout = zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED)
        for name, content in files.items():
            zout.writestr(name, content)
        zout.close()
        out_buf.seek(0)
        return out_buf


excel_generator = ExcelGenerator()
