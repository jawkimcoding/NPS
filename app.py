import os
import urllib.parse
from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import shutil

from data_manager import data_manager
from excel_generator import excel_generator

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
DATA_DIR = os.path.join(BASE_DIR, "data")
TEMPLATES_EXCEL_DIR = os.path.join(BASE_DIR, "templates_excel")

os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(TEMPLATES_EXCEL_DIR, exist_ok=True)

app = FastAPI(title="KPC 만족도 및 교육운영결과보고서 대시보드")

# 정적 파일 마운트
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")
app.mount("/templates_excel", StaticFiles(directory=TEMPLATES_EXCEL_DIR), name="templates_excel")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


class CommentUpdateRequest(BaseModel):
    comment_key: str
    instructor_feedback: Optional[List[str]] = []
    content_feedback: Optional[List[str]] = []
    recommend_feedback: Optional[List[str]] = []
    instructor_sentiment: Optional[List[str]] = []
    content_sentiment: Optional[List[str]] = []
    recommend_sentiment: Optional[List[str]] = []
    operation_feedback: Optional[List[str]] = []
    additional_courses: Optional[List[str]] = []


class CurriculumUpdateRequest(BaseModel):
    course_name: str
    instructor_name: str
    curriculum_text: str


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


@app.get("/api/filter-options")
async def get_filter_options():
    return data_manager.get_filter_options()


@app.get("/api/report")
async def get_report(
    course_name: str = Query(..., description="과정명"),
    instructor_name: Optional[str] = Query(None, description="강사명"),
    mode: str = Query("instructor", description="보고서 모드: instructor or course")
):
    data = data_manager.get_report_data(course_name, instructor_name, mode)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data


@app.post("/api/comments")
async def update_comments(req: CommentUpdateRequest):
    data_manager.save_comments(req.comment_key, {
        "instructor_feedback": req.instructor_feedback,
        "content_feedback": req.content_feedback,
        "recommend_feedback": req.recommend_feedback,
        "instructor_sentiment": req.instructor_sentiment,
        "content_sentiment": req.content_sentiment,
        "recommend_sentiment": req.recommend_sentiment,
        "operation_feedback": req.operation_feedback,
        "additional_courses": req.additional_courses
    })
    return {"status": "success", "message": "주관식 의견이 저장되었습니다."}


@app.post("/api/curriculum")
async def update_curriculum(req: CurriculumUpdateRequest):
    data_manager.save_curriculum(req.course_name, req.instructor_name, req.curriculum_text)
    return {"status": "success", "message": "커리큘럼 내용이 저장되었습니다."}


@app.post("/api/upload")
async def upload_raw_data(file: UploadFile = File(...)):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.")

    save_path = os.path.join(UPLOADS_DIR, file.filename)
    try:
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        imported_count = data_manager.import_raw_excel(save_path)
        return {
            "status": "success",
            "message": f"성공적으로 {imported_count}건의 로우데이터를 반영/누적하였습니다.",
            "total_records": len(data_manager.records)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 처리 중 오류 발생: {str(e)}")


@app.get("/api/download-excel")
async def download_excel(
    course_name: str = Query(...),
    instructor_name: Optional[str] = Query(None),
    mode: str = Query("instructor")
):
    report_data = data_manager.get_report_data(course_name, instructor_name, mode)
    if "error" in report_data:
        raise HTTPException(status_code=404, detail=report_data["error"])

    excel_io = excel_generator.generate(report_data)

    # 안전한 파일명 생성
    target_name = f"{course_name}({instructor_name})_강사별만족도" if mode == "instructor" and instructor_name else f"{course_name}_교육운영결과보고서"
    clean_target = "".join(c for c in target_name if c.isalnum() or c in (" ", "_", "-", "(", ")", "[", "]")).strip()
    filename = f"{clean_target}.xlsx"
    encoded_filename = urllib.parse.quote(filename)

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
    }

    return StreamingResponse(
        excel_io,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
