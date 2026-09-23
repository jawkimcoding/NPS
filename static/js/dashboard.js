// 대시보드 상태 관리
let filterOptions = { courses: [], instructors: [], course_details: {}, total_records: 0 };
let currentReportData = null;
let currentSheetIndex = 0;
let currentMode = 'instructor'; // 'instructor' 또는 'course'
let charts = {}; // Chart.js 인스턴스들 보관
let isServerAvailable = false;

document.addEventListener('DOMContentLoaded', async () => {
  initUIEvents();
  await checkServerAndLoadData();

  // URL 파라미터 확인하거나 기본 샘플 로드
  const params = new URLSearchParams(window.location.search);
  const qCourse = params.get('course');
  const qInst = params.get('instructor');
  if (qCourse) {
    selectSampleCourse(qCourse, qInst || '');
  }
});

// 서버 가용성 체크 및 필터 옵션 로드
async function checkServerAndLoadData() {
  try {
    const res = await fetch('/api/filter-options', { method: 'GET' });
    if (res.ok) {
      filterOptions = await res.json();
      isServerAvailable = true;
    } else {
      throw new Error('Server API not responding');
    }
  } catch (e) {
    console.log('Running in Client-Side Mode (GitHub Pages / Standalone)');
    isServerAvailable = false;
    if (window.clientEngine) {
      filterOptions = window.clientEngine.getFilterOptions();
    }
  }

  document.getElementById('recordCount').textContent = (filterOptions.total_records || 0).toLocaleString();
}

// UI 이벤트 등록
function initUIEvents() {
  const searchInput = document.getElementById('courseSearchInput');
  const dropdown = document.getElementById('courseDropdown');
  const clearBtn = document.getElementById('btnClearSearch');
  const instSelect = document.getElementById('instructorSelect');
  const btnSearch = document.getElementById('btnSearch');
  const btnDownload = document.getElementById('btnDownloadExcel');
  const btnSaveComments = document.getElementById('btnSaveComments');

  // 모드 탭 전환
  document.getElementById('tabInstructorMode').addEventListener('click', () => switchMode('instructor'));
  document.getElementById('tabCourseMode').addEventListener('click', () => switchMode('course'));

  // 검색 인풋 이벤트
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val) {
      clearBtn.classList.remove('hidden');
      renderCourseDropdown(val);
    } else {
      clearBtn.classList.add('hidden');
      dropdown.classList.add('hidden');
    }
  });

  searchInput.addEventListener('focus', (e) => {
    if (e.target.value.trim()) {
      renderCourseDropdown(e.target.value.trim());
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    dropdown.classList.add('hidden');
    instSelect.innerHTML = '<option value="">강사를 선택하세요</option>';
  });

  // 바깥 클릭 시 드롭다운 닫기
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // 조회 버튼 클릭
  btnSearch.addEventListener('click', () => {
    const course = searchInput.value.trim();
    const inst = instSelect.value;
    if (!course) {
      showToast('과정명을 먼저 선택해 주세요.', 'error');
      return;
    }
    fetchReport(course, currentMode === 'instructor' ? inst : null);
  });

  // 주관식 의견 저장 버튼
  btnSaveComments.addEventListener('click', saveCurrentComments);

  // 엑셀 다운로드 버튼
  btnDownload.addEventListener('click', downloadExcel);

  // 로우데이터 업로드 모달 이벤트
  initUploadModal();
}

// 모드 전환
function switchMode(mode) {
  currentMode = mode;
  const tabInst = document.getElementById('tabInstructorMode');
  const tabCourse = document.getElementById('tabCourseMode');
  const instWrapper = document.getElementById('instructorFilterWrapper');
  const paperTitle = document.getElementById('paperMainTitle');

  if (mode === 'instructor') {
    tabInst.className = 'mode-tab active px-3.5 py-1.5 rounded text-xs font-bold bg-[#4472C4] text-white transition';
    tabCourse.className = 'mode-tab px-3.5 py-1.5 rounded text-xs font-medium text-slate-700 hover:bg-slate-100 transition border border-slate-300';
    instWrapper.style.display = 'block';
    paperTitle.textContent = '교육 운영 결과 보고서';
  } else {
    tabCourse.className = 'mode-tab active px-3.5 py-1.5 rounded text-xs font-bold bg-[#217346] text-white transition';
    tabInst.className = 'mode-tab px-3.5 py-1.5 rounded text-xs font-medium text-slate-700 hover:bg-slate-100 transition border border-slate-300';
    instWrapper.style.display = 'none';
    paperTitle.textContent = '교육 운영 결과 보고서';
  }

  const course = document.getElementById('courseSearchInput').value.trim();
  const inst = document.getElementById('instructorSelect').value;
  if (course && currentReportData) {
    fetchReport(course, currentMode === 'instructor' ? inst : null);
  }
}

// 과정 드롭다운 렌더링
function renderCourseDropdown(query) {
  const dropdown = document.getElementById('courseDropdown');
  const q = query.toLowerCase();
  const matched = filterOptions.courses.filter(c => c.toLowerCase().includes(q)).slice(0, 30);

  if (matched.length === 0) {
    dropdown.innerHTML = '<div class="p-2.5 text-xs text-slate-400 text-center">일치하는 과정이 없습니다.</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matched.map(c => `
    <div class="px-3.5 py-2 text-xs hover:bg-blue-50 hover:text-[#4472C4] cursor-pointer font-medium text-slate-800 transition flex items-center justify-between" onclick="selectCourse('${escapeQuotes(c)}')">
      <span>${escapeHtml(c)}</span>
      <span class="text-[11px] text-slate-400 font-normal">선택</span>
    </div>
  `).join('');
  dropdown.classList.remove('hidden');
}

// 과정 선택 시 강사 드롭다운 갱신
function selectCourse(courseName) {
  document.getElementById('courseSearchInput').value = courseName;
  document.getElementById('courseDropdown').classList.add('hidden');
  document.getElementById('btnClearSearch').classList.remove('hidden');

  const instSelect = document.getElementById('instructorSelect');
  instSelect.innerHTML = '<option value="">강사를 선택하세요</option>';

  const details = filterOptions.course_details[courseName];
  if (details && details.instructors.length > 0) {
    details.instructors.forEach(inst => {
      const opt = document.createElement('option');
      opt.value = inst;
      opt.textContent = inst;
      instSelect.appendChild(opt);
    });
    instSelect.value = details.instructors[0];
  }

  fetchReport(courseName, currentMode === 'instructor' ? instSelect.value : null);
}

// 샘플 과정 선택 헬퍼
window.selectSampleCourse = function(courseName, instName) {
  document.getElementById('courseSearchInput').value = courseName;
  document.getElementById('btnClearSearch').classList.remove('hidden');

  if (instName) {
    switchMode('instructor');
    const instSelect = document.getElementById('instructorSelect');
    instSelect.innerHTML = `<option value="${instName}">${instName}</option>`;
    instSelect.value = instName;
    fetchReport(courseName, instName);
  } else {
    switchMode('course');
    fetchReport(courseName, null);
  }
};

// 보고서 데이터 조회
async function fetchReport(courseName, instructorName) {
  showLoading(true);
  try {
    if (isServerAvailable) {
      let url = `/api/report?course_name=${encodeURIComponent(courseName)}&mode=${currentMode}`;
      if (instructorName && currentMode === 'instructor') {
        url += `&instructor_name=${encodeURIComponent(instructorName)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || '보고서 조회 실패');
      }
      currentReportData = await res.json();
    } else {
      currentReportData = window.clientEngine.getReportData(courseName, instructorName, currentMode);
      if (currentReportData.error) {
        throw new Error(currentReportData.error);
      }
    }

    currentSheetIndex = 0;
    renderRoundTabs();
    renderCurrentSheet();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// 차수별 탭 렌더링
function renderRoundTabs() {
  const container = document.getElementById('roundTabContainer');
  const btnBox = document.getElementById('roundTabButtons');
  
  if (!currentReportData || !currentReportData.sheets || currentReportData.sheets.length <= 1) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  btnBox.innerHTML = currentReportData.sheets.map((s, idx) => `
    <button onclick="switchSheet(${idx})" class="px-2.5 py-1 rounded text-xs font-bold transition ${idx === currentSheetIndex ? 'bg-[#4472C4] text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'}">
      ${escapeHtml(s.sheet_title)}
    </button>
  `).join('');
}

function switchSheet(idx) {
  currentSheetIndex = idx;
  renderRoundTabs();
  renderCurrentSheet();
}

// 현재 선택된 차수 시트 화면 렌더링 (샘플 엑셀 서식 100% 미러링)
function renderCurrentSheet() {
  if (!currentReportData || !currentReportData.sheets || currentReportData.sheets.length === 0) {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('reportPaper').classList.add('hidden');
    return;
  }

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('reportPaper').classList.remove('hidden');

  const sheet = currentReportData.sheets[currentSheetIndex];

  // R4~R5: 과정명, 일정, 설문인원
  document.getElementById('viewCourseName').textContent = sheet.course_name;
  document.getElementById('viewPeriod').textContent = sheet.display_period;
  document.getElementById('viewRespondentCount').textContent = sheet.respondent_count;

  // R9~R11: 1. 설문 결과 분석 테이블
  const tbody = document.getElementById('scoresTableBody');
  tbody.innerHTML = '';

  sheet.instructors.forEach((inst, iIdx) => {
    const cur = inst.current;
    const cum = inst.cumulative;
    
    // 이번 차수 행 (R10)
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `
      <td class="text-center font-normal align-middle">${escapeHtml(inst.instructor_name)}</td>
      <td class="align-middle text-[9pt] leading-tight" rowspan="2">
        <textarea id="currInput_${iIdx}" class="w-full text-[9pt] p-1 border border-transparent hover:border-slate-300 focus:border-blue-500 rounded resize-none" rows="3" onblur="saveCurriculum('${escapeQuotes(sheet.course_name)}', '${escapeQuotes(inst.instructor_name)}', this.value)">${escapeHtml(inst.curriculum)}</textarea>
      </td>
      <td class="text-center font-normal whitespace-pre-line leading-tight">이번\n차수</td>
      <td class="text-center font-normal">${cur.teaching_expertise.toFixed(1)}</td>
      <td class="text-center font-normal">${cur.delivery_skill.toFixed(1)}</td>
      <td class="text-center font-normal">${cur.practical_use.toFixed(1)}</td>
      <td class="text-center font-normal">${cur.textbook_quality.toFixed(1)}</td>
    `;
    tbody.appendChild(tr1);

    // 누적 차수 행 (R11)
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `
      <td class="text-center font-normal align-middle">${inst.hours}</td>
      <td class="text-center font-normal whitespace-pre-line leading-tight">누적\n차수</td>
      <td class="text-center font-normal">${cum.teaching_expertise.toFixed(2)}</td>
      <td class="text-center font-normal">${cum.delivery_skill.toFixed(2)}</td>
      <td class="text-center font-normal">${cum.practical_use.toFixed(2)}</td>
      <td class="text-center font-normal">${cum.textbook_quality.toFixed(2)}</td>
    `;
    tbody.appendChild(tr2);
  });

  // 6개 차트 렌더링 (Office Accent1 테마 블루 색상: #4472C4)
  renderAllCharts(sheet.charts);

  // R60 이후: 2. 이번 교육 운영 결과표 (주관식 후기 테이블)
  renderCommentsSection(sheet);
}

// 6개 차트 렌더링
function renderAllCharts(chartsData) {
  const chartBlue = '#4472C4'; // Office 기본 테마 단색 블루

  // Chart 0: 교육과정내용 만족도 추이 (Full Width)
  renderBarChart('chartSatisfactionTrend', chartsData.chart0_satisfaction_trend.categories, chartsData.chart0_satisfaction_trend.values, '만족도', chartBlue, 5);

  // Chart 1: 추천지수(NPS) 추이 (Full Width)
  renderBarChart('chartNpsTrend', chartsData.chart1_nps_trend.categories, chartsData.chart1_nps_trend.values, 'NPS', chartBlue, 100);

  // Chart 4: 교육생 직급 (Half Width)
  renderBarChart('chartPositions', chartsData.chart4_positions.categories, chartsData.chart4_positions.values, '인원', chartBlue);

  // Chart 3: 희망 교육형태 (Half Width)
  renderBarChart('chartPreferredFormat', chartsData.chart3_preferred_format.categories, chartsData.chart3_preferred_format.values, '인원', chartBlue);

  // Chart 5: 과정정보 출처 (Half Width)
  renderBarChart('chartMotives', chartsData.chart5_motives.categories, chartsData.chart5_motives.values, '인원', chartBlue);

  // Chart 2: 교육운영 불편요소 (Half Width)
  renderBarChart('chartComplaints', chartsData.chart2_complaints.categories, chartsData.chart2_complaints.values, '건수', chartBlue);
}

function renderBarChart(canvasId, labels, data, label, color, maxVal = null) {
  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  const ctx = document.getElementById(canvasId).getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        backgroundColor: color,
        borderRadius: 0,
        maxBarThickness: 45
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` ${label}: ${item.formattedValue}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: maxVal,
          grid: { color: '#e5e7eb' },
          ticks: { font: { size: 10, family: 'Malgun Gothic' } }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 10, family: 'Malgun Gothic' } }
        }
      }
    }
  });
}

// 주관식 후기 테이블 동적 렌더링 (강사별만족도 / 교육운영결과보고서 양식 맞춤)
function renderCommentsSection(sheet) {
  const tbody = document.getElementById('commentsTableBody');
  tbody.innerHTML = '';

  const comments = sheet.comments || {};
  const isInstructorMode = (currentMode === 'instructor');

  if (isInstructorMode) {
    // 강사별 만족도 샘플 양식: 3개 섹션 + '긍정' 배지
    const sections = [
      { key: 'instructor_feedback', title: '  강사님 관련 의견', idPrefix: 'commInst' },
      { key: 'content_feedback', title: '  교육 내용 관련 의견', idPrefix: 'commContent' },
      { key: 'recommend_feedback', title: '  본 교육과정 추천 시 추천 사유', idPrefix: 'commRec' }
    ];

    sections.forEach(sec => {
      const items = comments[sec.key] || [];
      const rowCount = Math.max(4, items.length);

      for (let i = 0; i < rowCount; i++) {
        const tr = document.createElement('tr');
        if (i === 0) {
          tr.innerHTML = `
            <td class="font-bold text-center align-middle" style="width: 25%;" rowspan="${rowCount}">${escapeHtml(sec.title)}</td>
            <td class="text-center align-middle" style="width: 10%;"><span class="badge-positive">긍정</span></td>
            <td style="width: 65%;">
              <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(items[i] || '')}" class="w-full text-xs p-1 border-0 focus:ring-1 focus:ring-blue-500 rounded" placeholder="의견을 입력하세요" />
            </td>
          `;
        } else {
          tr.innerHTML = `
            <td class="text-center align-middle"><span class="badge-positive">긍정</span></td>
            <td>
              <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(items[i] || '')}" class="w-full text-xs p-1 border-0 focus:ring-1 focus:ring-blue-500 rounded" placeholder="의견을 입력하세요" />
            </td>
          `;
        }
        tbody.appendChild(tr);
      }
    });

  } else {
    // 교육운영결과보고서 샘플 양식: 5개 섹션
    const sections = [
      { key: 'instructor_feedback', title: '  강사님 관련 의견', idPrefix: 'commInst', defaultCount: 2 },
      { key: 'content_feedback', title: '  교육 내용 관련 의견', idPrefix: 'commContent', defaultCount: 1 },
      { key: 'operation_feedback', title: '  교육 신청에서 종료까지 교육 운영 관련 의견', idPrefix: 'commOper', defaultCount: 1 },
      { key: 'recommend_feedback', title: '  본 교육과정 추천 시 추천 사유', idPrefix: 'commRec', defaultCount: 3 },
      { key: 'additional_courses', title: '  추가로 개설이 되었으면 하는 과정 혹은 부문', idPrefix: 'commAdd', defaultCount: 1 }
    ];

    sections.forEach(sec => {
      const items = comments[sec.key] || [];
      const rowCount = Math.max(sec.defaultCount, items.length);

      for (let i = 0; i < rowCount; i++) {
        const tr = document.createElement('tr');
        if (i === 0) {
          tr.innerHTML = `
            <td class="font-bold align-middle pl-3" style="width: 38%;" rowspan="${rowCount}">${escapeHtml(sec.title)}</td>
            <td style="width: 62%;">
              <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(items[i] || '')}" class="w-full text-xs p-1 border-0 focus:ring-1 focus:ring-emerald-600 rounded" placeholder="의견을 입력하세요" />
            </td>
          `;
        } else {
          tr.innerHTML = `
            <td>
              <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(items[i] || '')}" class="w-full text-xs p-1 border-0 focus:ring-1 focus:ring-emerald-600 rounded" placeholder="의견을 입력하세요" />
            </td>
          `;
        }
        tbody.appendChild(tr);
      }
    });
  }
}

// 주관식 의견 저장
async function saveCurrentComments() {
  if (!currentReportData || !currentReportData.sheets) return;
  const sheet = currentReportData.sheets[currentSheetIndex];

  const commentsObj = {};
  if (currentMode === 'instructor') {
    commentsObj.instructor_feedback = [0,1,2,3,4].map(i => document.getElementById(`commInst${i}`)?.value?.trim()).filter(Boolean);
    commentsObj.content_feedback = [0,1,2,3,4].map(i => document.getElementById(`commContent${i}`)?.value?.trim()).filter(Boolean);
    commentsObj.recommend_feedback = [0,1,2,3,4].map(i => document.getElementById(`commRec${i}`)?.value?.trim()).filter(Boolean);
  } else {
    commentsObj.instructor_feedback = [0,1,2,3].map(i => document.getElementById(`commInst${i}`)?.value?.trim()).filter(Boolean);
    commentsObj.content_feedback = [0,1,2,3].map(i => document.getElementById(`commContent${i}`)?.value?.trim()).filter(Boolean);
    commentsObj.operation_feedback = [0,1,2,3].map(i => document.getElementById(`commOper${i}`)?.value?.trim()).filter(Boolean);
    commentsObj.recommend_feedback = [0,1,2,3].map(i => document.getElementById(`commRec${i}`)?.value?.trim()).filter(Boolean);
    commentsObj.additional_courses = [0,1,2,3].map(i => document.getElementById(`commAdd${i}`)?.value?.trim()).filter(Boolean);
  }

  try {
    if (isServerAvailable) {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_key: sheet.comment_key,
          ...commentsObj
        })
      });
      if (!res.ok) throw new Error('저장 실패');
    } else if (window.clientEngine) {
      window.clientEngine.saveComments(sheet.comment_key, commentsObj);
    }
    
    sheet.comments = commentsObj;
    showToast('주관식 의견이 성공적으로 저장되었습니다!');
  } catch (err) {
    showToast('주관식 의견 저장 중 오류가 발생했습니다.', 'error');
  }
}

// 커리큘럼 자동 저장
async function saveCurriculum(courseName, instructorName, text) {
  try {
    if (isServerAvailable) {
      await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_name: courseName,
          instructor_name: instructorName,
          curriculum_text: text
        })
      });
    } else if (window.clientEngine) {
      window.clientEngine.saveCurriculum(courseName, instructorName, text);
    }
  } catch (err) {
    console.error('Failed to auto-save curriculum:', err);
  }
}

// 엑셀 다운로드
async function downloadExcel() {
  if (!currentReportData) {
    showToast('먼저 과정을 선택해 주세요.', 'error');
    return;
  }
  
  if (isServerAvailable) {
    const course = document.getElementById('courseSearchInput').value.trim();
    const inst = document.getElementById('instructorSelect').value;
    let url = `/api/download-excel?course_name=${encodeURIComponent(course)}&mode=${currentMode}`;
    if (currentMode === 'instructor' && inst) {
      url += `&instructor_name=${encodeURIComponent(inst)}`;
    }
    window.location.href = url;
  } else if (window.clientEngine) {
    showToast('엑셀 보고서를 생성하는 중입니다...');
    try {
      await window.clientEngine.downloadExcel(currentReportData);
      showToast('엑셀 보고서 다운로드 완료!');
    } catch (err) {
      console.error(err);
      showToast('엑셀 생성 중 오류가 발생했습니다.', 'error');
    }
  }
}

// 업로드 모달 제어
function initUploadModal() {
  const modal = document.getElementById('uploadModal');
  const btnOpen = document.getElementById('btnOpenUpload');
  const btnClose = document.getElementById('btnCloseUploadModal');
  const btnCancel = document.getElementById('btnCancelUpload');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const statusDiv = document.getElementById('uploadStatus');

  btnOpen.addEventListener('click', () => {
    modal.classList.remove('hidden');
    statusDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
  });

  const closeModal = () => {
    modal.classList.add('hidden');
    fileInput.value = '';
  };
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  // 클릭 시 파일 탐색기 열기 (버블링 방지)
  dropZone.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  // 드래그 앤 드롭 이벤트 방어
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('border-emerald-600', 'bg-emerald-100/60');
    });
  });

  ['dragleave', 'dragend'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('border-emerald-600', 'bg-emerald-100/60');
    });
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('border-emerald-600', 'bg-emerald-100/60');

    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      await handleFileUpload(dt.files[0]);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await handleFileUpload(file);
      fileInput.value = ''; // 재업로드를 위해 반드시 리셋
    }
  });

  async function handleFileUpload(file) {
    if (!file) return;

    statusDiv.className = 'text-xs p-2.5 rounded font-medium bg-blue-50 text-blue-700 flex items-center';
    statusDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> [${escapeHtml(file.name)}] 파싱 및 데이터 누적 중...`;
    statusDiv.classList.remove('hidden');

    try {
      let importedCount = 0;
      let totalRecords = 0;

      if (isServerAvailable) {
        // 서버 모드: FastAPI /api/upload
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '업로드 실패');

        await checkServerAndLoadData();
        totalRecords = filterOptions.total_records || 0;
        importedCount = data.imported_count || totalRecords;
      } else {
        // 브라우저 자립형 모드: ClientEngine + IndexedDB
        if (!window.clientEngine) {
          throw new Error('클라이언트 엔진을 찾을 수 없습니다.');
        }
        importedCount = await window.clientEngine.parseAndMergeExcel(file);
        filterOptions = window.clientEngine.getFilterOptions();
        totalRecords = filterOptions.total_records;
        document.getElementById('recordCount').textContent = totalRecords.toLocaleString();
      }

      statusDiv.className = 'text-xs p-2.5 rounded font-medium bg-emerald-50 text-emerald-800 flex items-center';
      statusDiv.innerHTML = `<i class="fa-solid fa-circle-check mr-2"></i> 성공: <b>${importedCount.toLocaleString()}건</b>의 데이터가 누적되었습니다! (총 ${totalRecords.toLocaleString()}건)`;

      showToast(`새 로우데이터가 성공적으로 반영되었습니다! (총 ${totalRecords.toLocaleString()}건)`);

      // 현재 열려있는 과정이 있다면 바로 재조회
      const course = document.getElementById('courseSearchInput').value.trim();
      if (course) {
        const inst = document.getElementById('instructorSelect').value;
        fetchReport(course, currentMode === 'instructor' ? inst : null);
      }
    } catch (err) {
      console.error('File upload error:', err);
      statusDiv.className = 'text-xs p-2.5 rounded font-medium bg-rose-50 text-rose-700 flex items-center';
      statusDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> 오류 발생: ${escapeHtml(err.message || '파일 처리 실패')}`;
      showToast('엑셀 업로드 중 오류가 발생했습니다.', 'error');
    }
  }
}

// 로딩 상태 제어
function showLoading(show) {
  document.getElementById('loadingIndicator').classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('reportPaper').classList.add('hidden');
  }
}

// 토스트 메시지
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toastMessage');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastText');

  text.textContent = msg;
  if (type === 'error') {
    icon.className = 'fa-solid fa-circle-xmark text-rose-400';
  } else {
    icon.className = 'fa-solid fa-circle-check text-emerald-400';
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeQuotes(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
