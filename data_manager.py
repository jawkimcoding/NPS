import os
import json
import re
import openpyxl
from typing import Dict, List, Any, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
SURVEY_STORE_PATH = os.path.join(DATA_DIR, "survey_store.json")
COMMENTS_STORE_PATH = os.path.join(DATA_DIR, "comments_store.json")
CURRICULUM_STORE_PATH = os.path.join(DATA_DIR, "curriculum_store.json")

os.makedirs(DATA_DIR, exist_ok=True)


def parse_schedule(schedule_raw: str):
    """
    [YYYY-MM-DD ~ YYYY-MM-DD] N차 또는 제N차 파싱
    """
    if not schedule_raw:
        return {"raw": "", "start_date": "", "end_date": "", "month": 0, "round_name": "", "display_period": ""}
    
    s = str(schedule_raw).strip()
    m = re.search(r'\[\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*\]\s*(.*)', s)
    if m:
        start_date, end_date, round_name = m.groups()
        round_name = round_name.strip()
        month = int(start_date.split('-')[1])
        return {
            "raw": s,
            "start_date": start_date,
            "end_date": end_date,
            "month": month,
            "round_name": round_name,
            "display_period": f"{start_date} ~ {end_date}"
        }
    
    # 일자만 있는 경우
    m2 = re.search(r'(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})', s)
    if m2:
        start_date, end_date = m2.groups()
        month = int(start_date.split('-')[1])
        return {
            "raw": s,
            "start_date": start_date,
            "end_date": end_date,
            "month": month,
            "round_name": "",
            "display_period": f"{start_date} ~ {end_date}"
        }
    
    return {"raw": s, "start_date": "", "end_date": "", "month": 0, "round_name": "", "display_period": s}


def safe_float(v, default=0.0):
    if v is None:
        return default
    try:
        return round(float(v), 2)
    except (ValueError, TypeError):
        return default


def safe_int(v, default=0):
    if v is None:
        return default
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return default


class DataManager:
    def __init__(self):
        self.records: List[Dict[str, Any]] = []
        self.comments: Dict[str, Any] = {}
        self.curriculums: Dict[str, str] = {}
        self.load_all()

    def load_all(self):
        """저장된 JSON 또는 기본 로우데이터 파일에서 데이터 로드"""
        if os.path.exists(SURVEY_STORE_PATH):
            try:
                with open(SURVEY_STORE_PATH, "r", encoding="utf-8") as f:
                    self.records = json.load(f)
            except Exception as e:
                print(f"Error loading survey store: {e}")
                self.records = []

        # 저장소가 비어있으면 기본 엑셀에서 로드
        if not self.records:
            default_raw_file = os.path.join(BASE_DIR, "과정별설문결과_2026-09-23_로우데이터.xlsx")
            if os.path.exists(default_raw_file):
                self.import_raw_excel(default_raw_file)

        # 주관식 의견 로드
        if os.path.exists(COMMENTS_STORE_PATH):
            try:
                with open(COMMENTS_STORE_PATH, "r", encoding="utf-8") as f:
                    self.comments = json.load(f)
            except Exception as e:
                print(f"Error loading comments: {e}")
                self.comments = {}

        # 커리큘럼 로드
        if os.path.exists(CURRICULUM_STORE_PATH):
            try:
                with open(CURRICULUM_STORE_PATH, "r", encoding="utf-8") as f:
                    self.curriculums = json.load(f)
            except Exception as e:
                print(f"Error loading curriculums: {e}")
                self.curriculums = {}

    def save_survey_store(self):
        with open(SURVEY_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(self.records, f, ensure_ascii=False, indent=2)

    def save_comments_store(self):
        with open(COMMENTS_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(self.comments, f, ensure_ascii=False, indent=2)

    def save_curriculum_store(self):
        with open(CURRICULUM_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(self.curriculums, f, ensure_ascii=False, indent=2)

    def import_raw_excel(self, file_path: str) -> int:
        """로우데이터 엑셀 파일을 읽어와 레코드 병합 및 저장 (지능형 헤더 감지)"""
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active

        # 1. 헤더 행 위치 지능형 탐색
        header_row_idx = 2  # 기본값
        for r in range(1, min(10, ws.max_row + 1)):
            row_vals = [str(ws.cell(r, c).value or '').strip() for c in range(1, min(20, ws.max_column + 1))]
            if any('과정명' in v for v in row_vals):
                header_row_idx = r
                break

        # 헤더 컬럼 맵핑 구성
        col_map = {}
        for c in range(1, ws.max_column + 1):
            val = str(ws.cell(header_row_idx, c).value or '').strip()
            if not val and header_row_idx > 1:
                # 상위 행 확인 (예: 추천지수(NPS), 과정만족도 등)
                val = str(ws.cell(header_row_idx - 1, c).value or '').strip()
            if val:
                col_map[val] = c

        def get_col(keywords, default_c):
            for k, c in col_map.items():
                for kw in keywords:
                    if kw in k:
                        return c
            return default_c

        c_course = get_col(['과정명', '과정'], 1)
        c_sched = get_col(['교육일정', '일정', '차수'], 2)
        c_region = get_col(['지역'], 3)
        c_inst = get_col(['강사명', '강사'], 4)
        c_hours = get_col(['강의시간', '시간'], 5)
        c_sent = get_col(['발송수'], 6)
        c_resp = get_col(['응답수'], 7)
        c_nps = get_col(['추천지수', 'NPS'], 8)
        c_course_sat = get_col(['과정만족도'], 9)
        c_inst_avg = get_col(['만족도평균'], 10)
        c_expertise = get_col(['강의전문성', '강의내용'], 11)
        c_delivery = get_col(['전달능력'], 12)
        c_practical = get_col(['교육효과성', '실무활용도'], 13)
        c_textbook = get_col(['교재완성도'], 14)

        imported_count = 0
        existing_keys = {
            f"{r.get('course_name')}_{r.get('schedule_raw')}_{r.get('instructor_name')}": idx 
            for idx, r in enumerate(self.records)
        }

        for row_idx in range(header_row_idx + 1, ws.max_row + 1):
            course_name = ws.cell(row_idx, c_course).value
            if not course_name or str(course_name).strip() == '' or str(course_name).strip() == '과정명':
                continue
            
            course_name = str(course_name).strip()
            schedule_raw = str(ws.cell(row_idx, c_sched).value or "").strip()
            region = str(ws.cell(row_idx, c_region).value or "").strip()
            instructor_name = str(ws.cell(row_idx, c_inst).value or "").strip()
            
            sched_info = parse_schedule(schedule_raw)

            record = {
                "course_name": course_name,
                "schedule_raw": schedule_raw,
                "start_date": sched_info["start_date"],
                "end_date": sched_info["end_date"],
                "month": sched_info["month"],
                "round_name": sched_info["round_name"],
                "display_period": sched_info["display_period"],
                "region": region,
                "instructor_name": instructor_name,
                "hours": safe_int(ws.cell(row_idx, c_hours).value),
                "sent_count": safe_int(ws.cell(row_idx, c_sent).value),
                "respondent_count": safe_int(ws.cell(row_idx, c_resp).value),
                "nps": safe_float(ws.cell(row_idx, c_nps).value),
                "course_satisfaction": safe_float(ws.cell(row_idx, c_course_sat).value),
                "instructor_satisfaction_avg": safe_float(ws.cell(row_idx, c_inst_avg).value),
                "teaching_expertise": safe_float(ws.cell(row_idx, c_expertise).value),
                "delivery_skill": safe_float(ws.cell(row_idx, c_delivery).value),
                "practical_use": safe_float(ws.cell(row_idx, c_practical).value),
                "textbook_quality": safe_float(ws.cell(row_idx, c_textbook).value),
                "complaints": {
                    "정보": safe_int(ws.cell(row_idx, 15).value),
                    "절차": safe_int(ws.cell(row_idx, 16).value),
                    "운영": safe_int(ws.cell(row_idx, 17).value),
                    "환경": safe_int(ws.cell(row_idx, 18).value),
                    "일정": safe_int(ws.cell(row_idx, 19).value),
                    "기타": safe_int(ws.cell(row_idx, 20).value),
                },
                "motives": {
                    "SNS": safe_int(ws.cell(row_idx, 21).value),
                    "이메일": safe_int(ws.cell(row_idx, 22).value),
                    "홈페이지": safe_int(ws.cell(row_idx, 23).value),
                    "인쇄물": safe_int(ws.cell(row_idx, 24).value),
                    "인터넷": safe_int(ws.cell(row_idx, 25).value),
                    "담당자추천": safe_int(ws.cell(row_idx, 26).value),
                    "동료추천": safe_int(ws.cell(row_idx, 27).value),
                    "기타": safe_int(ws.cell(row_idx, 28).value),
                },
                "positions": {
                    "사원": safe_int(ws.cell(row_idx, 29).value),
                    "대리": safe_int(ws.cell(row_idx, 30).value),
                    "과장": safe_int(ws.cell(row_idx, 31).value),
                    "차장": safe_int(ws.cell(row_idx, 32).value),
                    "부팀장": safe_int(ws.cell(row_idx, 33).value),
                    "임원": safe_int(ws.cell(row_idx, 34).value),
                },
                "preferred_formats": {
                    "오프라인": safe_int(ws.cell(row_idx, 35).value),
                    "비대면": safe_int(ws.cell(row_idx, 36).value),
                    "이러닝": safe_int(ws.cell(row_idx, 37).value),
                    "플립러닝": safe_int(ws.cell(row_idx, 38).value),
                },
                "course_code": str(ws.cell(row_idx, 39).value or ""),
                "round_code": str(ws.cell(row_idx, 40).value or ""),
                "instructor_code": str(ws.cell(row_idx, 41).value or ""),
            }

            key = f"{course_name}_{schedule_raw}_{instructor_name}"
            if key in existing_keys:
                self.records[existing_keys[key]] = record
            else:
                existing_keys[key] = len(self.records)
                self.records.append(record)
            
            imported_count += 1

        self.save_survey_store()
        return imported_count

    def get_filter_options(self) -> Dict[str, Any]:
        """검색용 전체 과정 목록, 강사 목록 반환"""
        courses = sorted(list({r["course_name"] for r in self.records}))
        instructors = sorted(list({r["instructor_name"] for r in self.records if r["instructor_name"]}))
        
        # 과정별 강사 및 일정 매핑
        course_details = {}
        for r in self.records:
            c = r["course_name"]
            if c not in course_details:
                course_details[c] = {"instructors": set(), "schedules": []}
            if r["instructor_name"]:
                course_details[c]["instructors"].add(r["instructor_name"])
            course_details[c]["schedules"].append({
                "raw": r["schedule_raw"],
                "start_date": r["start_date"],
                "month": r["month"],
                "round_name": r["round_name"],
                "display": r["display_period"]
            })
            
        for c in course_details:
            course_details[c]["instructors"] = sorted(list(course_details[c]["instructors"]))
            # 날짜순 정렬
            course_details[c]["schedules"].sort(key=lambda x: x["start_date"])

        return {
            "courses": courses,
            "instructors": instructors,
            "course_details": course_details,
            "total_records": len(self.records)
        }

    def get_report_data(self, course_name: str, instructor_name: Optional[str] = None, mode: str = "instructor") -> Dict[str, Any]:
        """
        특정 과정 및 (선택적) 강사에 대한 보고서 데이터 생성
        mode: 'instructor' (강사별만족도) 또는 'course' (교육운영결과보고서)
        """
        # 1. 일치하는 레코드 필터링
        filtered = [r for r in self.records if r["course_name"] == course_name]
        if instructor_name:
            filtered = [r for r in filtered if r["instructor_name"] == instructor_name]

        if not filtered:
            return {"error": "해당 조건의 데이터가 존재하지 않습니다."}

        # 2. 일정 시작일 순 정렬
        filtered.sort(key=lambda x: (x["start_date"], x["schedule_raw"]))

        # 3. 차수별/월별 그룹화
        # 차수 식별자: schedule_raw
        # 하나의 차수에 여러 강사가 있을 수 있으므로 차수별로 묶음
        rounds_dict = {}
        for r in filtered:
            sched = r["schedule_raw"]
            if sched not in rounds_dict:
                rounds_dict[sched] = {
                    "schedule_raw": sched,
                    "start_date": r["start_date"],
                    "end_date": r["end_date"],
                    "month": r["month"],
                    "round_name": r["round_name"],
                    "display_period": r["display_period"],
                    "respondent_count": r["respondent_count"],
                    "course_satisfaction": r["course_satisfaction"],
                    "nps": r["nps"],
                    "records": []
                }
            rounds_dict[sched]["records"].append(r)
            # 만약 여러 강사 레코드라면 대표 설문인원이나 합계
            rounds_dict[sched]["respondent_count"] = max(rounds_dict[sched]["respondent_count"], r["respondent_count"])
            rounds_dict[sched]["course_satisfaction"] = r["course_satisfaction"]
            rounds_dict[sched]["nps"] = r["nps"]

        ordered_rounds = sorted(list(rounds_dict.values()), key=lambda x: x["start_date"])

        # 4. 차수별 누적 평균 계산
        # 차수 진행에 따라 1차, 2차... 누적 평균 계산
        cumulative_scores = {
            "teaching_expertise": [],
            "delivery_skill": [],
            "practical_use": [],
            "textbook_quality": [],
            "course_satisfaction": [],
            "nps": []
        }

        # 각 시트(차수)별 상세 데이터 구성
        sheet_data_list = []
        
        # 차수별 누적 추이용 히스토리
        trend_history = {
            "labels": [],
            "satisfaction": [],
            "nps": []
        }

        for idx, round_item in enumerate(ordered_rounds):
            trend_history["labels"].append(round_item["display_period"] or f"{round_item['month']}월")
            trend_history["satisfaction"].append(round_item["course_satisfaction"])
            trend_history["nps"].append(round_item["nps"])

            # 강사별 이번 차수 및 누적 차수 계산
            instructor_rows = []
            for rec in round_item["records"]:
                inst = rec["instructor_name"]
                # 해당 강사의 과거 모든 차수(이번 차수 포함) 점수 수집
                past_inst_records = []
                for p_round in ordered_rounds[:idx+1]:
                    for p_rec in p_round["records"]:
                        if p_rec["instructor_name"] == inst:
                            past_inst_records.append(p_rec)

                # 누적 평균
                count = len(past_inst_records)
                cum_expertise = round(sum(p["teaching_expertise"] for p in past_inst_records) / count, 3) if count > 0 else rec["teaching_expertise"]
                cum_delivery = round(sum(p["delivery_skill"] for p in past_inst_records) / count, 3) if count > 0 else rec["delivery_skill"]
                cum_practical = round(sum(p["practical_use"] for p in past_inst_records) / count, 3) if count > 0 else rec["practical_use"]
                cum_textbook = round(sum(p["textbook_quality"] for p in past_inst_records) / count, 3) if count > 0 else rec["textbook_quality"]

                # 커리큘럼 텍스트
                curr_key = f"{course_name}_{inst}"
                curriculum_text = self.curriculums.get(curr_key, f"과정: {course_name}\n강의시간: {rec['hours']}시간")

                instructor_rows.append({
                    "instructor_name": inst,
                    "curriculum": curriculum_text,
                    "hours": rec["hours"],
                    "current": {
                        "teaching_expertise": rec["teaching_expertise"], # 강의내용
                        "delivery_skill": rec["delivery_skill"],         # 전달능력
                        "practical_use": rec["practical_use"],           # 실무활용도
                        "textbook_quality": rec["textbook_quality"]       # 교재완성도
                    },
                    "cumulative": {
                        "teaching_expertise": cum_expertise,
                        "delivery_skill": cum_delivery,
                        "practical_use": cum_practical,
                        "textbook_quality": cum_textbook
                    }
                })

            # 차트 데이터 (차트 0~5)
            # 차트 0: 교육과정내용 만족도 추이 (현재 차수까지의 추이)
            chart0_data = {
                "categories": list(trend_history["labels"]),
                "values": list(trend_history["satisfaction"])
            }
            # 차트 1: 추천지수(NPS) 추이 (현재 차수까지의 추이)
            chart1_data = {
                "categories": list(trend_history["labels"]),
                "values": list(trend_history["nps"])
            }
            
            # 차트 2~5: 해당 차수의 합계 (복수 레코드일 경우 합산 혹은 대표)
            # 불편요소
            comp_keys = ["정보", "절차", "운영", "환경", "일정", "기타"]
            comp_vals = [sum(r["complaints"].get(k, 0) for r in round_item["records"]) for k in comp_keys]
            
            # 희망 형태
            form_keys = ["오프라인", "비대면", "이러닝", "플립러닝"]
            form_vals = [sum(r["preferred_formats"].get(k, 0) for r in round_item["records"]) for k in form_keys]

            # 직급
            pos_keys = ["사원", "대리", "과장", "차장", "부팀장", "임원"]
            pos_vals = [sum(r["positions"].get(k, 0) for r in round_item["records"]) for k in pos_keys]

            # 수강동기 (과정정보 출처)
            mot_keys = ["SNS", "이메일", "홈페이지", "인쇄물", "인터넷", "담당자추천", "동료추천", "기타"]
            mot_vals = [sum(r["motives"].get(k, 0) for r in round_item["records"]) for k in mot_keys]

            # 주관식 코멘트 가져오기
            comment_key = f"{course_name}_{round_item['schedule_raw']}_{instructor_name or 'all'}"
            round_comments = self.comments.get(comment_key, {
                "instructor_feedback": [],
                "content_feedback": [],
                "recommend_feedback": []
            })

            # 시트명 결정 (예: 3월, 7월 등)
            sheet_title = f"{round_item['month']}월" if round_item["month"] else f"{idx+1}차"
            # 중복 방지
            existing_sheet_titles = [s["sheet_title"] for s in sheet_data_list]
            if sheet_title in existing_sheet_titles:
                sheet_title = f"{sheet_title}({round_item['round_name'] or idx+1})"

            sheet_data_list.append({
                "sheet_title": sheet_title,
                "schedule_raw": round_item["schedule_raw"],
                "display_period": round_item["display_period"],
                "respondent_count": round_item["respondent_count"],
                "course_name": course_name,
                "instructors": instructor_rows,
                "charts": {
                    "chart0_satisfaction_trend": chart0_data,
                    "chart1_nps_trend": chart1_data,
                    "chart2_complaints": {"categories": comp_keys, "values": comp_vals},
                    "chart3_preferred_format": {"categories": form_keys, "values": form_vals},
                    "chart4_positions": {"categories": pos_keys, "values": pos_vals},
                    "chart5_motives": {"categories": mot_keys, "values": mot_vals},
                },
                "comments": round_comments,
                "comment_key": comment_key
            })

        return {
            "course_name": course_name,
            "instructor_name": instructor_name,
            "mode": mode,
            "sheets": sheet_data_list
        }

    def save_comments(self, comment_key: str, comments: Dict[str, List[str]]):
        self.comments[comment_key] = comments
        self.save_comments_store()

    def save_curriculum(self, course_name: str, instructor_name: str, curriculum_text: str):
        curr_key = f"{course_name}_{instructor_name}"
        self.curriculums[curr_key] = curriculum_text
        self.save_curriculum_store()


# 싱글톤 인스턴스
data_manager = DataManager()
