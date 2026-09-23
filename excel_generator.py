import os
import io
import copy
import openpyxl
from openpyxl.chart.data_source import NumData, NumVal, StrData, StrVal, NumDataSource, AxDataSource
from typing import Dict, Any, List

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates_excel")
TEMPLATE_INSTRUCTOR = os.path.join(TEMPLATES_DIR, "template_instructor.xlsx")
TEMPLATE_COURSE = os.path.join(TEMPLATES_DIR, "template_course.xlsx")


def update_chart_data(chart, categories: List[str], values: List[float]):
    """Openpyxl 차트 객체의 카테고리와 값 데이터를 갱신"""
    if not chart.series:
        return
    s = chart.series[0]
    
    # 1. Categories (StrLit or StrRef cache)
    str_data = StrData(pt=[StrVal(idx=i, v=str(cat)) for i, cat in enumerate(categories)])
    if hasattr(s, 'cat') and s.cat and hasattr(s.cat, 'strRef') and s.cat.strRef:
        s.cat.strRef.strCache = str_data
    else:
        s.cat = AxDataSource(strLit=str_data)

    # 2. Values (NumLit or NumRef cache)
    num_data = NumData(pt=[NumVal(idx=i, v=float(val)) for i, val in enumerate(values)])
    if hasattr(s, 'val') and s.val and hasattr(s.val, 'numRef') and s.val.numRef:
        s.val.numRef.numCache = num_data
    else:
        s.val = NumDataSource(numLit=num_data)


class ExcelGenerator:
    def __init__(self):
        pass

    def generate(self, report_data: Dict[str, Any]) -> io.BytesIO:
        """
        report_data를 바탕으로 원본 서식을 복제한 엑셀 파일 생성
        """
        mode = report_data.get("mode", "instructor")
        template_path = TEMPLATE_INSTRUCTOR if mode == "instructor" else TEMPLATE_COURSE
        
        if not os.path.exists(template_path):
            template_path = TEMPLATE_INSTRUCTOR

        wb = openpyxl.load_workbook(template_path)
        
        sheets_data = report_data.get("sheets", [])
        if not sheets_data:
            out = io.BytesIO()
            wb.save(out)
            out.seek(0)
            return out

        # 원본 시트들 중 첫 번째 시트를 베이스 템플릿으로 저장하고 나머지 기존 시트 삭제
        base_sheet = wb[wb.sheetnames[0]]
        base_charts = [copy.deepcopy(c) for c in base_sheet._charts]

        initial_sheetnames = list(wb.sheetnames)
        for sname in initial_sheetnames[1:]:
            del wb[sname]

        created_sheets = []

        for idx, sdata in enumerate(sheets_data):
            sheet_title = sdata.get("sheet_title", f"{idx+1}차")
            # 시트명 특수문자 제거 및 31자 제한
            clean_title = sheet_title.replace("/", "_").replace("\\", "_").replace("?", "_").replace("*", "_").replace(":", "_").replace("[", "_").replace("]", "_")[:30]

            if idx == 0:
                ws = base_sheet
                ws.title = clean_title
            else:
                ws = wb.copy_worksheet(base_sheet)
                ws.title = clean_title
                # openpyxl 차트 복제 버그 방지: deepcopy
                ws._charts = [copy.deepcopy(c) for c in base_charts]

            created_sheets.append(ws)

            # 1. 헤더 기본 정보 입력
            ws['B5'].value = sdata.get("course_name", "")
            ws['G5'].value = sdata.get("display_period", "")
            ws['I5'].value = sdata.get("respondent_count", 0)

            # 2. 강사 및 커리큘럼 / 점수 입력
            instructors = sdata.get("instructors", [])
            if instructors:
                inst0 = instructors[0]
                ws['B10'].value = inst0.get("instructor_name", "")
                ws['C10'].value = inst0.get("curriculum", "")
                ws['B11'].value = inst0.get("hours", "")

                cur = inst0.get("current", {})
                cum = inst0.get("cumulative", {})

                ws['F10'].value = cur.get("teaching_expertise", 0.0)
                ws['G10'].value = cur.get("delivery_skill", 0.0)
                ws['H10'].value = cur.get("practical_use", 0.0)
                ws['I10'].value = cur.get("textbook_quality", 0.0)

                ws['F11'].value = cum.get("teaching_expertise", 0.0)
                ws['G11'].value = cum.get("delivery_skill", 0.0)
                ws['H11'].value = cum.get("practical_use", 0.0)
                ws['I11'].value = cum.get("textbook_quality", 0.0)

            # 3. 6개 차트 데이터 갱신
            charts_data = sdata.get("charts", {})
            if len(ws._charts) >= 6:
                # Chart 0: 교육과정내용 만족도 추이
                c0 = charts_data.get("chart0_satisfaction_trend", {})
                if c0:
                    update_chart_data(ws._charts[0], c0.get("categories", []), c0.get("values", []))

                # Chart 1: 추천지수(NPS) 추이
                c1 = charts_data.get("chart1_nps_trend", {})
                if c1:
                    update_chart_data(ws._charts[1], c1.get("categories", []), c1.get("values", []))

                # Chart 2: 교육운영 불편요소
                c2 = charts_data.get("chart2_complaints", {})
                if c2:
                    update_chart_data(ws._charts[2], c2.get("categories", []), c2.get("values", []))

                # Chart 3: 희망 교육형태
                c3 = charts_data.get("chart3_preferred_format", {})
                if c3:
                    update_chart_data(ws._charts[3], c3.get("categories", []), c3.get("values", []))

                # Chart 4: 교육생 직급
                c4 = charts_data.get("chart4_positions", {})
                if c4:
                    update_chart_data(ws._charts[4], c4.get("categories", []), c4.get("values", []))

                # Chart 5: 과정정보 출처
                c5 = charts_data.get("chart5_motives", {})
                if c5:
                    update_chart_data(ws._charts[5], c5.get("categories", []), c5.get("values", []))

            # 4. 주관식 후기 반영 (R61 이후)
            comments = sdata.get("comments", {})
            inst_feedbacks = comments.get("instructor_feedback", [])
            content_feedbacks = comments.get("content_feedback", [])
            rec_feedbacks = comments.get("recommend_feedback", [])

            # 기존 템플릿의 R61-64 (강사), R65-68 (내용), R69-72 (추천) 채우기
            for i in range(4):
                val = inst_feedbacks[i] if i < len(inst_feedbacks) else ""
                ws.cell(61 + i, 5).value = val
                
            for i in range(4):
                val = content_feedbacks[i] if i < len(content_feedbacks) else ""
                ws.cell(65 + i, 5).value = val

            for i in range(4):
                val = rec_feedbacks[i] if i < len(rec_feedbacks) else ""
                ws.cell(69 + i, 5).value = val

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return out


excel_generator = ExcelGenerator()
