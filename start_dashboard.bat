@echo off
chcp 65001 > nul
title KPC 교육운영결과 & 만족도 대시보드
echo ========================================================
echo   KPC 교육운영결과 및 강사만족도 대시보드 시스템 시작
echo ========================================================
echo.
echo 1. 웹 서버를 실행하는 중입니다 (http://localhost:8000)...
echo.
start "" http://localhost:8000
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
pause
