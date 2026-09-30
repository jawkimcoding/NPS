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
  const btnResetNav = document.getElementById('btnResetDataNav');
  const btnDeleteCourse = document.getElementById('btnDeleteCurrentCourse');

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
      if (btnDeleteCourse) btnDeleteCourse.classList.add('hidden');
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
    if (btnDeleteCourse) btnDeleteCourse.classList.add('hidden');
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

  // 상단 네비게이션 데이터 초기화 버튼
  if (btnResetNav) {
    btnResetNav.addEventListener('click', handleResetData);
  }

  // 현재 과정 삭제 버튼
  if (btnDeleteCourse) {
    btnDeleteCourse.addEventListener('click', handleDeleteCurrentCourse);
  }

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

  const btnDel = document.getElementById('btnDeleteCurrentCourse');
  if (btnDel) btnDel.classList.remove('hidden');

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

  const btnDel = document.getElementById('btnDeleteCurrentCourse');
  if (btnDel) btnDel.classList.remove('hidden');

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

  // Chart 0: 교육과정내용 만족도 추이 (1회차: 막대그래프, 누적 2회차 이상: 꺾은선그래프)
  renderTrendChart('chartSatisfactionTrend', chartsData.chart0_satisfaction_trend.categories, chartsData.chart0_satisfaction_trend.values, '만족도', chartBlue, 5);

  // Chart 1: 추천지수(NPS) 추이 (1회차: 막대그래프, 누적 2회차 이상: 꺾은선그래프)
  renderTrendChart('chartNpsTrend', chartsData.chart1_nps_trend.categories, chartsData.chart1_nps_trend.values, 'NPS', chartBlue, 100);

  // Chart 4: 교육생 직급 (Half Width)
  renderBarChart('chartPositions', chartsData.chart4_positions.categories, chartsData.chart4_positions.values, '인원', chartBlue);

  // Chart 3: 희망 교육형태 (Half Width)
  renderBarChart('chartPreferredFormat', chartsData.chart3_preferred_format.categories, chartsData.chart3_preferred_format.values, '인원', chartBlue);

  // Chart 5: 과정정보 출처 (Half Width)
  renderBarChart('chartMotives', chartsData.chart5_motives.categories, chartsData.chart5_motives.values, '인원', chartBlue);

  // Chart 2: 교육운영 불편요소 (Half Width)
  renderBarChart('chartComplaints', chartsData.chart2_complaints.categories, chartsData.chart2_complaints.values, '건수', chartBlue);
}

// 만족도 및 NPS 추이 차트 (1회차는 막대, 2회차 이상 누적 시 꺾은선으로 렌더링)
function renderTrendChart(canvasId, labels, data, label, color, maxVal = null) {
  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  const isLine = labels && labels.length > 1;
  const ctx = document.getElementById(canvasId).getContext('2d');

  // 데이터 정제 (만족도는 0~5.0 범위 강제, NPS는 -100~100)
  const cleanData = (data || []).map(v => {
    const num = Number(v) || 0;
    if (label === '만족도') {
      return Number(Math.min(5.0, Math.max(0, num)).toFixed(1));
    }
    return Number(num.toFixed(1));
  });

  const isNps = label === 'NPS';
  const minVal = isNps && cleanData.some(v => v < 0) ? -100 : 0;

  if (isLine) {
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: cleanData,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2.5,
          pointBackgroundColor: color,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: false,
          tension: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` ${label}: ${item.formattedValue}${isNps ? '점' : '점 / 5.0'}`
            }
          }
        },
        scales: {
          y: {
            min: minVal,
            max: maxVal ? maxVal : undefined,
            suggestedMax: maxVal,
            grid: { color: '#e5e7eb' },
            ticks: {
              stepSize: label === '만족도' ? 1 : undefined,
              font: { size: 10, family: 'Malgun Gothic' }
            }
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, family: 'Malgun Gothic' } }
          }
        }
      }
    });
  } else {
    renderBarChart(canvasId, labels, cleanData, label, color, maxVal);
  }
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

// 감성에 따른 배지 클래스 반환
function getSentimentBadgeClass(sentiment) {
  if (sentiment === '중립' || sentiment === '보완') return 'badge-neutral';
  if (sentiment === '부정') return 'badge-negative';
  return 'badge-positive';
}

// 감성 드롭다운 변경 시 배지 클래스 실시간 전환
function updateSentimentSelectClass(selectEl) {
  selectEl.classList.remove('badge-positive', 'badge-neutral', 'badge-negative');
  selectEl.classList.add(getSentimentBadgeClass(selectEl.value));
}

// 현재 화면의 주관식 입력값을 sheet.comments 객체에 즉시 동기화
function syncInputsToComments() {
  if (!currentReportData || !currentReportData.sheets) return;
  const sheet = currentReportData.sheets[currentSheetIndex];
  if (!sheet) return;

  sheet.comments = sheet.comments || {};
  const isInstructorMode = (currentMode === 'instructor');

  if (isInstructorMode) {
    const sections = [
      { key: 'instructor_feedback', sentKey: 'instructor_sentiment', idPrefix: 'commInst' },
      { key: 'content_feedback', sentKey: 'content_sentiment', idPrefix: 'commContent' },
      { key: 'recommend_feedback', sentKey: 'recommend_sentiment', idPrefix: 'commRec' }
    ];
    sections.forEach(sec => {
      const texts = [];
      const sents = [];
      for (let i = 0; i < 50; i++) {
        const textEl = document.getElementById(`${sec.idPrefix}${i}`);
        if (!textEl) break;
        texts.push(textEl.value);
        const sentEl = document.getElementById(`${sec.idPrefix}Sent${i}`);
        sents.push(sentEl ? sentEl.value : '긍정');
      }
      sheet.comments[sec.key] = texts;
      sheet.comments[sec.sentKey] = sents;
    });
  } else {
    const sections = [
      { key: 'instructor_feedback', idPrefix: 'commInst' },
      { key: 'content_feedback', idPrefix: 'commContent' },
      { key: 'operation_feedback', idPrefix: 'commOper' },
      { key: 'recommend_feedback', idPrefix: 'commRec' },
      { key: 'additional_courses', idPrefix: 'commAdd' }
    ];
    sections.forEach(sec => {
      const texts = [];
      for (let i = 0; i < 50; i++) {
        const textEl = document.getElementById(`${sec.idPrefix}${i}`);
        if (!textEl) break;
        texts.push(textEl.value);
      }
      sheet.comments[sec.key] = texts;
    });
  }
}

// 주관식 항목 추가
window.addCommentItem = function(secKey, sentKey) {
  syncInputsToComments();
  const sheet = currentReportData.sheets[currentSheetIndex];
  if (!sheet) return;

  sheet.comments = sheet.comments || {};
  sheet.comments[secKey] = sheet.comments[secKey] || [];
  sheet.comments[secKey].push('');

  if (sentKey) {
    sheet.comments[sentKey] = sheet.comments[sentKey] || [];
    sheet.comments[sentKey].push('긍정');
  }

  renderCommentsSection(sheet);
};

// 주관식 항목 삭제
window.removeCommentItem = function(secKey, sentKey, idx) {
  syncInputsToComments();
  const sheet = currentReportData.sheets[currentSheetIndex];
  if (!sheet) return;

  sheet.comments = sheet.comments || {};
  if (sheet.comments[secKey]) {
    sheet.comments[secKey].splice(idx, 1);
  }
  if (sentKey && sheet.comments[sentKey]) {
    sheet.comments[sentKey].splice(idx, 1);
  }

  renderCommentsSection(sheet);
};

// 주관식 후기 테이블 동적 렌더링 (강사별만족도 / 교육운영결과보고서 양식 맞춤 & 동적 행 추가/삭제 지원)
function renderCommentsSection(sheet) {
  const tbody = document.getElementById('commentsTableBody');
  tbody.innerHTML = '';

  const comments = sheet.comments || {};
  const isInstructorMode = (currentMode === 'instructor');

  if (isInstructorMode) {
    // 강사별 만족도 샘플 양식: 3개 섹션 + '긍정/중립/부정' 선택 드롭다운 + 동적 행 추가/삭제
    const sections = [
      { key: 'instructor_feedback', sentKey: 'instructor_sentiment', title: '강사님 관련 의견', idPrefix: 'commInst', defaultCount: 4 },
      { key: 'content_feedback', sentKey: 'content_sentiment', title: '교육 내용 관련 의견', idPrefix: 'commContent', defaultCount: 4 },
      { key: 'recommend_feedback', sentKey: 'recommend_sentiment', title: '본 교육과정 추천 시 추천 사유', idPrefix: 'commRec', defaultCount: 4 }
    ];

    sections.forEach(sec => {
      let items = comments[sec.key] || [];
      let sents = comments[sec.sentKey] || [];

      // 최소 기본 칸수 보장
      if (items.length === 0) {
        items = Array(sec.defaultCount).fill('');
        sents = Array(sec.defaultCount).fill('긍정');
        comments[sec.key] = items;
        comments[sec.sentKey] = sents;
      }
      const rowCount = items.length;

      for (let i = 0; i < rowCount; i++) {
        const tr = document.createElement('tr');
        const textVal = items[i] || '';
        const sentVal = sents[i] || '긍정';
        const badgeClass = getSentimentBadgeClass(sentVal);

        const selectHtml = `
          <select id="${sec.idPrefix}Sent${i}" class="badge-select ${badgeClass}" onchange="updateSentimentSelectClass(this)">
            <option value="긍정" ${sentVal === '긍정' ? 'selected' : ''}>긍정</option>
            <option value="중립" ${sentVal === '중립' || sentVal === '보완' ? 'selected' : ''}>중립</option>
            <option value="부정" ${sentVal === '부정' ? 'selected' : ''}>부정</option>
          </select>
        `;

        const deleteBtnHtml = `
          <button type="button" onclick="removeCommentItem('${sec.key}', '${sec.sentKey}', ${i})" class="text-slate-400 hover:text-rose-600 px-1.5 py-0.5 rounded transition text-xs ml-1 flex-shrink-0" title="이 항목 삭제">
            <i class="fa-solid fa-xmark"></i>
          </button>
        `;

        if (i === 0) {
          const headerHtml = `
            <div class="flex items-center justify-between px-1.5">
              <span class="font-bold text-slate-800">${escapeHtml(sec.title)}</span>
              <button type="button" onclick="addCommentItem('${sec.key}', '${sec.sentKey}')" class="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded border border-slate-300 transition shadow-xs flex items-center" title="의견 칸 추가">
                <i class="fa-solid fa-plus text-[10px] mr-1"></i>추가
              </button>
            </div>
          `;
          tr.innerHTML = `
            <td class="align-middle bg-slate-50/70" style="width: 25%;" rowspan="${rowCount}">${headerHtml}</td>
            <td class="text-center align-middle" style="width: 12%;">${selectHtml}</td>
            <td style="width: 63%;">
              <div class="flex items-center">
                <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(textVal)}" class="flex-1 text-xs p-1 border-0 focus:ring-1 focus:ring-blue-500 rounded" placeholder="의견을 입력하세요" />
                ${deleteBtnHtml}
              </div>
            </td>
          `;
        } else {
          tr.innerHTML = `
            <td class="text-center align-middle">${selectHtml}</td>
            <td>
              <div class="flex items-center">
                <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(textVal)}" class="flex-1 text-xs p-1 border-0 focus:ring-1 focus:ring-blue-500 rounded" placeholder="의견을 입력하세요" />
                ${deleteBtnHtml}
              </div>
            </td>
          `;
        }
        tbody.appendChild(tr);
      }
    });

  } else {
    // 교육운영결과보고서 샘플 양식: 5개 섹션 + 동적 행 추가/삭제
    const sections = [
      { key: 'instructor_feedback', title: '강사님 관련 의견', idPrefix: 'commInst', defaultCount: 2 },
      { key: 'content_feedback', title: '교육 내용 관련 의견', idPrefix: 'commContent', defaultCount: 1 },
      { key: 'operation_feedback', title: '교육 신청에서 종료까지 교육 운영 관련 의견', idPrefix: 'commOper', defaultCount: 1 },
      { key: 'recommend_feedback', title: '본 교육과정 추천 시 추천 사유', idPrefix: 'commRec', defaultCount: 3 },
      { key: 'additional_courses', title: '추가로 개설이 되었으면 하는 과정 혹은 부문', idPrefix: 'commAdd', defaultCount: 1 }
    ];

    sections.forEach(sec => {
      let items = comments[sec.key] || [];
      if (items.length === 0) {
        items = Array(sec.defaultCount).fill('');
        comments[sec.key] = items;
      }
      const rowCount = items.length;

      for (let i = 0; i < rowCount; i++) {
        const tr = document.createElement('tr');
        const deleteBtnHtml = `
          <button type="button" onclick="removeCommentItem('${sec.key}', '', ${i})" class="text-slate-400 hover:text-rose-600 px-1.5 py-0.5 rounded transition text-xs ml-1 flex-shrink-0" title="이 항목 삭제">
            <i class="fa-solid fa-xmark"></i>
          </button>
        `;

        if (i === 0) {
          const headerHtml = `
            <div class="flex items-center justify-between px-1.5">
              <span class="font-bold text-slate-800">${escapeHtml(sec.title)}</span>
              <button type="button" onclick="addCommentItem('${sec.key}', '')" class="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded border border-slate-300 transition shadow-xs flex items-center" title="의견 칸 추가">
                <i class="fa-solid fa-plus text-[10px] mr-1"></i>추가
              </button>
            </div>
          `;
          tr.innerHTML = `
            <td class="align-middle bg-slate-50/70 pl-2" style="width: 38%;" rowspan="${rowCount}">${headerHtml}</td>
            <td style="width: 62%;">
              <div class="flex items-center">
                <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(items[i] || '')}" class="flex-1 text-xs p-1 border-0 focus:ring-1 focus:ring-emerald-600 rounded" placeholder="의견을 입력하세요" />
                ${deleteBtnHtml}
              </div>
            </td>
          `;
        } else {
          tr.innerHTML = `
            <td>
              <div class="flex items-center">
                <input type="text" id="${sec.idPrefix}${i}" value="${escapeHtml(items[i] || '')}" class="flex-1 text-xs p-1 border-0 focus:ring-1 focus:ring-emerald-600 rounded" placeholder="의견을 입력하세요" />
                ${deleteBtnHtml}
              </div>
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
  if (!sheet) return;

  syncInputsToComments();
  const commentsObj = sheet.comments || {};

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
      await window.clientEngine.saveComments(sheet.comment_key, commentsObj);
    }
    
    showToast('주관식 의견이 성공적으로 저장 및 연동되었습니다!');
  } catch (err) {
    console.error('Comments save error:', err);
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

  const btnResetUploaded = document.getElementById('btnResetUploadedData');
  if (btnResetUploaded) {
    btnResetUploaded.addEventListener('click', handleResetData);
  }

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

    const isReplace = document.getElementById('uploadModeReplace')?.checked ?? true;
    const modeText = isReplace ? '전체 교체' : '데이터 누적';

    statusDiv.className = 'text-xs p-2.5 rounded font-medium bg-blue-50 text-blue-700 flex items-center';
    statusDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> [${escapeHtml(file.name)}] 파싱 및 ${modeText} 진행 중...`;
    statusDiv.classList.remove('hidden');

    try {
      let importedCount = 0;
      let totalRecords = 0;

      if (isServerAvailable) {
        // 서버 모드: FastAPI /api/upload
        const formData = new FormData();
        formData.append('file', file);
        formData.append('replace_mode', isReplace ? 'true' : 'false');
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
        importedCount = await window.clientEngine.parseAndMergeExcel(file, isReplace);
        filterOptions = window.clientEngine.getFilterOptions();
        totalRecords = filterOptions.total_records;
        document.getElementById('recordCount').textContent = totalRecords.toLocaleString();
      }

      statusDiv.className = 'text-xs p-2.5 rounded font-medium bg-emerald-50 text-emerald-800 flex items-center';
      const actionText = isReplace ? '전체 교체' : '누적';
      statusDiv.innerHTML = `<i class="fa-solid fa-circle-check mr-2"></i> 성공: <b>${importedCount.toLocaleString()}건</b>의 데이터가 ${actionText}되었습니다! (총 ${totalRecords.toLocaleString()}건)`;

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

// 업로드된 데이터 초기화 (기본 내장 데이터로 복원)
async function handleResetData() {
  const confirmed = confirm(
    '업로드된 추가 데이터를 모두 삭제하고 초기 기본 상태(870건)로 복원하시겠습니까?\n\n' +
    '이 작업은 취소할 수 없으며 기본 내장 설문 데이터로 되돌아갑니다.'
  );
  if (!confirmed) return;

  showLoading(true);
  try {
    let totalCount = 0;
    if (isServerAvailable) {
      const res = await fetch('/api/reset-data', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '초기화 실패');
      totalCount = data.total_records;
    } else if (window.clientEngine) {
      totalCount = await window.clientEngine.resetUploadedData();
    }

    await checkServerAndLoadData();

    // 화면 상태 초기화
    document.getElementById('courseSearchInput').value = '';
    document.getElementById('btnClearSearch').classList.add('hidden');
    document.getElementById('courseDropdown').classList.add('hidden');
    document.getElementById('instructorSelect').innerHTML = '<option value="">강사를 선택하세요</option>';
    const btnDel = document.getElementById('btnDeleteCurrentCourse');
    if (btnDel) btnDel.classList.add('hidden');

    currentReportData = null;
    currentSheetIndex = 0;
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('reportPaper').classList.add('hidden');

    // 모달 닫기
    const modal = document.getElementById('uploadModal');
    if (modal) modal.classList.add('hidden');

    showToast(`데이터가 초기 기본 상태(${totalCount.toLocaleString()}건)로 복원되었습니다.`);
  } catch (err) {
    console.error('Reset data error:', err);
    showToast(err.message || '데이터 초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    showLoading(false);
  }
}

// 현재 선택된 과정 데이터 삭제
async function handleDeleteCurrentCourse() {
  const course = document.getElementById('courseSearchInput').value.trim();
  if (!course) {
    showToast('삭제할 과정이 선택되지 않았습니다.', 'error');
    return;
  }

  const confirmed = confirm(
    `정말로 '[${course}]' 과정의 모든 설문 데이터를 삭제하시겠습니까?\n\n` +
    '해당 과정의 모든 차수 데이터와 주관식 의견이 완전히 삭제됩니다.'
  );
  if (!confirmed) return;

  showLoading(true);
  try {
    let totalCount = 0;
    if (isServerAvailable) {
      const res = await fetch('/api/delete-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_name: course })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '삭제 실패');
      totalCount = data.total_records;
    } else if (window.clientEngine) {
      totalCount = await window.clientEngine.deleteCourse(course);
    }

    await checkServerAndLoadData();

    // 화면 상태 초기화
    document.getElementById('courseSearchInput').value = '';
    document.getElementById('btnClearSearch').classList.add('hidden');
    document.getElementById('courseDropdown').classList.add('hidden');
    document.getElementById('instructorSelect').innerHTML = '<option value="">강사를 선택하세요</option>';
    const btnDel = document.getElementById('btnDeleteCurrentCourse');
    if (btnDel) btnDel.classList.add('hidden');

    currentReportData = null;
    currentSheetIndex = 0;
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('reportPaper').classList.add('hidden');

    showToast(`'${course}' 과정 데이터가 삭제되었습니다. (남은 데이터: ${totalCount.toLocaleString()}건)`);
  } catch (err) {
    console.error('Delete course error:', err);
    showToast(err.message || '과정 데이터 삭제 중 오류가 발생했습니다.', 'error');
  } finally {
    showLoading(false);
  }
}
