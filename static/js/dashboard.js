// 대시보드 상태 관리
let filterOptions = { courses: [], instructors: [], course_details: {}, total_records: 0 };
let currentReportData = null;
let currentSheetIndex = 0;
let currentMode = 'instructor'; // 'instructor' 또는 'course'
let charts = {}; // Chart.js 인스턴스들 보관

document.addEventListener('DOMContentLoaded', async () => {
  initUIEvents();
  await loadFilterOptions();

  // URL 파라미터 확인하거나 기본 샘플 로드
  const params = new URLSearchParams(window.location.search);
  const qCourse = params.get('course');
  const qInst = params.get('instructor');
  if (qCourse) {
    selectSampleCourse(qCourse, qInst || '');
  }
});

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
    tabInst.className = 'mode-tab active px-4 py-2 rounded-lg text-sm font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 transition';
    tabCourse.className = 'mode-tab px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition border border-transparent';
    instWrapper.style.display = 'block';
    paperTitle.textContent = '교육 운영 결과 보고서 (강사별 만족도)';
  } else {
    tabCourse.className = 'mode-tab active px-4 py-2 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 transition';
    tabInst.className = 'mode-tab px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition border border-transparent';
    instWrapper.style.display = 'none';
    paperTitle.textContent = '교육 운영 결과 보고서 (과정 전체)';
  }

  // 현재 과정이 입력되어 있으면 바로 다시 조회
  const course = document.getElementById('courseSearchInput').value.trim();
  const inst = document.getElementById('instructorSelect').value;
  if (course && currentReportData) {
    fetchReport(course, currentMode === 'instructor' ? inst : null);
  }
}

// 필터 옵션 로드
async function loadFilterOptions() {
  try {
    const res = await fetch('/api/filter-options');
    filterOptions = await res.json();
    document.getElementById('recordCount').textContent = (filterOptions.total_records || 0).toLocaleString();
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
}

// 과정 드롭다운 렌더링
function renderCourseDropdown(query) {
  const dropdown = document.getElementById('courseDropdown');
  const q = query.toLowerCase();
  const matched = filterOptions.courses.filter(c => c.toLowerCase().includes(q)).slice(0, 30);

  if (matched.length === 0) {
    dropdown.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">일치하는 과정이 없습니다.</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matched.map(c => `
    <div class="px-4 py-2.5 text-sm hover:bg-indigo-50/70 hover:text-indigo-700 cursor-pointer font-medium text-slate-700 transition flex items-center justify-between" onclick="selectCourse('${escapeQuotes(c)}')">
      <span>${escapeHtml(c)}</span>
      <span class="text-xs text-slate-400 font-normal">선택</span>
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
    // 첫 번째 강사 자동 선택
    instSelect.value = details.instructors[0];
  }

  // 자동 조회
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
    <button onclick="switchSheet(${idx})" class="px-3 py-1.5 rounded-lg text-xs font-bold transition ${idx === currentSheetIndex ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
      ${escapeHtml(s.sheet_title)} (${s.display_period.split(' ~ ')[0].substring(5)})
    </button>
  `).join('');
}

function switchSheet(idx) {
  currentSheetIndex = idx;
  renderRoundTabs();
  renderCurrentSheet();
}

// 현재 선택된 차수 시트 화면 렌더링
function renderCurrentSheet() {
  if (!currentReportData || !currentReportData.sheets || currentReportData.sheets.length === 0) {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('reportPaper').classList.add('hidden');
    return;
  }

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('reportPaper').classList.remove('hidden');

  const sheet = currentReportData.sheets[currentSheetIndex];

  // 상단 정보
  document.getElementById('viewCourseName').textContent = sheet.course_name;
  document.getElementById('viewPeriod').textContent = sheet.display_period;
  document.getElementById('viewRespondentCount').textContent = `${sheet.respondent_count}명`;
  document.getElementById('currentRoundBadge').textContent = `${sheet.sheet_title} 보고서`;

  // 1. 설문 결과 분석 테이블
  const tbody = document.getElementById('scoresTableBody');
  tbody.innerHTML = '';

  sheet.instructors.forEach((inst, iIdx) => {
    const cur = inst.current;
    const cum = inst.cumulative;
    
    // 이번 차수 행
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `
      <td class="excel-td text-center font-bold bg-slate-50 align-middle" rowspan="2">
        ${escapeHtml(inst.instructor_name)}
        <div class="text-[11px] text-slate-400 font-normal mt-0.5">${inst.hours}시간</div>
      </td>
      <td class="excel-td align-top text-xs text-slate-700" rowspan="2">
        <textarea id="currInput_${iIdx}" class="w-full text-xs p-1 border-0 focus:ring-1 focus:ring-indigo-500 rounded resize-none" rows="3" onblur="saveCurriculum('${escapeQuotes(sheet.course_name)}', '${escapeQuotes(inst.instructor_name)}', this.value)">${escapeHtml(inst.curriculum)}</textarea>
      </td>
      <td class="excel-td text-center font-semibold bg-indigo-50/50 text-indigo-900">이번 차수</td>
      <td class="excel-td text-center font-bold text-slate-900">${cur.teaching_expertise.toFixed(1)}</td>
      <td class="excel-td text-center font-bold text-slate-900">${cur.delivery_skill.toFixed(1)}</td>
      <td class="excel-td text-center font-bold text-slate-900">${cur.practical_use.toFixed(1)}</td>
      <td class="excel-td text-center font-bold text-slate-900">${cur.textbook_quality.toFixed(1)}</td>
    `;
    tbody.appendChild(tr1);

    // 누적 차수 행
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `
      <td class="excel-td text-center font-semibold bg-emerald-50/50 text-emerald-900">누적 차수</td>
      <td class="excel-td text-center font-extrabold text-emerald-700 bg-emerald-50/20">${cum.teaching_expertise.toFixed(2)}</td>
      <td class="excel-td text-center font-extrabold text-emerald-700 bg-emerald-50/20">${cum.delivery_skill.toFixed(2)}</td>
      <td class="excel-td text-center font-extrabold text-emerald-700 bg-emerald-50/20">${cum.practical_use.toFixed(2)}</td>
      <td class="excel-td text-center font-extrabold text-emerald-700 bg-emerald-50/20">${cum.textbook_quality.toFixed(2)}</td>
    `;
    tbody.appendChild(tr2);
  });

  // 6개 시각화 차트 렌더링
  renderAllCharts(sheet.charts);

  // 2. 이번 교육 운영 결과표 (주관식 의견)
  const comm = sheet.comments || {};
  const instF = comm.instructor_feedback || [];
  const contF = comm.content_feedback || [];
  const recF = comm.recommend_feedback || [];

  for (let i = 0; i < 4; i++) {
    document.getElementById(`commInst${i}`).value = instF[i] || '';
    document.getElementById(`commContent${i}`).value = contF[i] || '';
    document.getElementById(`commRec${i}`).value = recF[i] || '';
  }
}

// 6개 차트 렌더링
function renderAllCharts(chartsData) {
  // Chart 0: 교육과정내용 만족도 추이 (막대)
  renderBarChart('chartSatisfactionTrend', chartsData.chart0_satisfaction_trend.categories, chartsData.chart0_satisfaction_trend.values, '만족도 (5점 만점)', '#4f46e5', 5);

  // Chart 1: 추천지수(NPS) 추이 (막대)
  renderBarChart('chartNpsTrend', chartsData.chart1_nps_trend.categories, chartsData.chart1_nps_trend.values, 'NPS 점수', '#0ea5e9', 100);

  // Chart 4: 교육생 직급 (막대)
  renderBarChart('chartPositions', chartsData.chart4_positions.categories, chartsData.chart4_positions.values, '인원수(명)', '#8b5cf6');

  // Chart 3: 희망 교육형태 (막대)
  renderBarChart('chartPreferredFormat', chartsData.chart3_preferred_format.categories, chartsData.chart3_preferred_format.values, '응답수(명)', '#10b981');

  // Chart 5: 과정정보 출처 (막대)
  renderBarChart('chartMotives', chartsData.chart5_motives.categories, chartsData.chart5_motives.values, '응답수(명)', '#f59e0b');

  // Chart 2: 교육운영 불편요소 (막대)
  renderBarChart('chartComplaints', chartsData.chart2_complaints.categories, chartsData.chart2_complaints.values, '건수', '#ef4444');
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
        borderRadius: 4,
        maxBarThickness: 36
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
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 } }
        }
      }
    }
  });
}

// 주관식 의견 저장
async function saveCurrentComments() {
  if (!currentReportData || !currentReportData.sheets) return;
  const sheet = currentReportData.sheets[currentSheetIndex];

  const instF = [0,1,2,3].map(i => document.getElementById(`commInst${i}`).value.trim()).filter(v => v);
  const contF = [0,1,2,3].map(i => document.getElementById(`commContent${i}`).value.trim()).filter(v => v);
  const recF = [0,1,2,3].map(i => document.getElementById(`commRec${i}`).value.trim()).filter(v => v);

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment_key: sheet.comment_key,
        instructor_feedback: instF,
        content_feedback: contF,
        recommend_feedback: recF
      })
    });
    if (!res.ok) throw new Error('저장 실패');
    
    // 로컬 상태 동기화
    sheet.comments = {
      instructor_feedback: instF,
      content_feedback: contF,
      recommend_feedback: recF
    };
    showToast('주관식 의견이 성공적으로 저장되었습니다!');
  } catch (err) {
    showToast('주관식 의견 저장 중 오류가 발생했습니다.', 'error');
  }
}

// 커리큘럼 자동 저장
async function saveCurriculum(courseName, instructorName, text) {
  try {
    await fetch('/api/curriculum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_name: courseName,
        instructor_name: instructorName,
        curriculum_text: text
      })
    });
  } catch (err) {
    console.error('Failed to auto-save curriculum:', err);
  }
}

// 엑셀 다운로드
function downloadExcel() {
  if (!currentReportData) {
    showToast('먼저 과정을 선택해 주세요.', 'error');
    return;
  }
  const course = document.getElementById('courseSearchInput').value.trim();
  const inst = document.getElementById('instructorSelect').value;
  let url = `/api/download-excel?course_name=${encodeURIComponent(course)}&mode=${currentMode}`;
  if (currentMode === 'instructor' && inst) {
    url += `&instructor_name=${encodeURIComponent(inst)}`;
  }
  window.location.href = url;
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
  });

  const closeModal = () => modal.classList.add('hidden');
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-600', 'bg-indigo-100/50');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-600', 'bg-indigo-100/50');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-600', 'bg-indigo-100/50');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  });

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    statusDiv.className = 'text-xs p-3 rounded-lg font-medium bg-indigo-50 text-indigo-700 flex items-center';
    statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> 파일 업로드 및 데이터 병합 중...';
    statusDiv.classList.remove('hidden');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '업로드 실패');

      statusDiv.className = 'text-xs p-3 rounded-lg font-medium bg-emerald-50 text-emerald-700 flex items-center';
      statusDiv.innerHTML = `<i class="fa-solid fa-circle-check mr-2"></i> ${data.message} (총 ${data.total_records.toLocaleString()}건)`;

      // 필터 옵션 새로고침
      await loadFilterOptions();
      showToast('새 로우데이터가 대시보드에 성공적으로 반영되었습니다!');

      // 현재 보고서가 열려있다면 새로고침
      const course = document.getElementById('courseSearchInput').value.trim();
      if (course) {
        const inst = document.getElementById('instructorSelect').value;
        fetchReport(course, currentMode === 'instructor' ? inst : null);
      }
    } catch (err) {
      statusDiv.className = 'text-xs p-3 rounded-lg font-medium bg-rose-50 text-rose-700 flex items-center';
      statusDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> ${err.message}`;
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
    icon.className = 'fa-solid fa-circle-xmark text-rose-400 text-base';
  } else {
    icon.className = 'fa-solid fa-circle-check text-emerald-400 text-base';
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
