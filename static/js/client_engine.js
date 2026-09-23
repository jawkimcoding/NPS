// 클라이언트 사이드 데이터 관리 및 연산 엔진 (100% 브라우저 자립형)
// IndexedDB 대용량 스토리지 지원으로 브라우저 용량 초과 에러 완벽 방지

class ClientEngine {
  constructor() {
    this.records = [];
    this.comments = {};
    this.curriculums = {};
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    // 1. 기본 내장 데이터 로드
    const defaultRecords = window.DEFAULT_SURVEY_RECORDS || [];
    const defaultComments = window.DEFAULT_COMMENTS || {};
    const defaultCurriculums = window.DEFAULT_CURRICULUMS || {};

    // 2. IndexedDB 초기화 및 추가 레코드 로드
    let extraRecords = [];
    let extraComments = {};
    let extraCurriculums = {};

    try {
      this.db = await this.openIndexedDB();
      extraRecords = (await this.getFromDB('custom_records')) || [];
      extraComments = (await this.getFromDB('custom_comments')) || {};
      extraCurriculums = (await this.getFromDB('custom_curriculums')) || {};
    } catch (e) {
      console.warn('IndexedDB unavailable, falling back to LocalStorage:', e);
      try {
        extraRecords = JSON.parse(localStorage.getItem('kpc_custom_records') || '[]');
        extraComments = JSON.parse(localStorage.getItem('kpc_custom_comments') || '{}');
        extraCurriculums = JSON.parse(localStorage.getItem('kpc_custom_curriculums') || '{}');
      } catch (err) {}
    }

    // 3. 레코드 병합 (과정명_일정_강사명 기준 중복 방지)
    const recordMap = new Map();
    defaultRecords.forEach(r => {
      recordMap.set(`${r.course_name}_${r.schedule_raw}_${r.instructor_name}`, r);
    });
    extraRecords.forEach(r => {
      recordMap.set(`${r.course_name}_${r.schedule_raw}_${r.instructor_name}`, r);
    });

    this.records = Array.from(recordMap.values());
    this.comments = { ...defaultComments, ...extraComments };
    this.curriculums = { ...defaultCurriculums, ...extraCurriculums };
  }

  openIndexedDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open('KPC_Survey_Database', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  getFromDB(key) {
    return new Promise((resolve) => {
      if (!this.db) { resolve(null); return; }
      try {
        const tx = this.db.transaction('store', 'readonly');
        const req = tx.objectStore('store').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  saveToDB(key, val) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        try {
          localStorage.setItem(`kpc_${key}`, JSON.stringify(val));
          resolve();
        } catch (e) {
          reject(e);
        }
        return;
      }
      try {
        const tx = this.db.transaction('store', 'readwrite');
        tx.objectStore('store').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  getFilterOptions() {
    const coursesSet = new Set();
    const instructorsSet = new Set();
    const courseDetails = {};

    this.records.forEach(r => {
      coursesSet.add(r.course_name);
      if (r.instructor_name) instructorsSet.add(r.instructor_name);

      if (!courseDetails[r.course_name]) {
        courseDetails[r.course_name] = { instructors: new Set(), schedules: [] };
      }
      if (r.instructor_name) {
        courseDetails[r.course_name].instructors.add(r.instructor_name);
      }
      courseDetails[r.course_name].schedules.push({
        raw: r.schedule_raw,
        start_date: r.start_date,
        month: r.month,
        round_name: r.round_name,
        display: r.display_period
      });
    });

    for (const c in courseDetails) {
      courseDetails[c].instructors = Array.from(courseDetails[c].instructors).sort();
      courseDetails[c].schedules.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    }

    return {
      courses: Array.from(coursesSet).sort(),
      instructors: Array.from(instructorsSet).sort(),
      course_details: courseDetails,
      total_records: this.records.length
    };
  }

  getReportData(courseName, instructorName, mode = 'instructor') {
    let filtered = this.records.filter(r => r.course_name === courseName);
    if (instructorName && mode === 'instructor') {
      filtered = filtered.filter(r => r.instructor_name === instructorName);
    }

    if (filtered.length === 0) {
      return { error: '해당 조건의 데이터가 존재하지 않습니다.' };
    }

    filtered.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

    // 차수별 그룹화
    const roundsMap = new Map();
    filtered.forEach(r => {
      const sched = r.schedule_raw;
      if (!roundsMap.has(sched)) {
        roundsMap.set(sched, {
          schedule_raw: sched,
          start_date: r.start_date,
          end_date: r.end_date,
          month: r.month,
          round_name: r.round_name,
          display_period: r.display_period,
          respondent_count: r.respondent_count,
          course_satisfaction: r.course_satisfaction,
          nps: r.nps,
          records: []
        });
      }
      const item = roundsMap.get(sched);
      item.records.push(r);
      item.respondent_count = Math.max(item.respondent_count, r.respondent_count);
      item.course_satisfaction = r.course_satisfaction;
      item.nps = r.nps;
    });

    const orderedRounds = Array.from(roundsMap.values()).sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    const sheetDataList = [];
    const trendHistory = { labels: [], satisfaction: [], nps: [] };

    orderedRounds.forEach((roundItem, idx) => {
      trendHistory.labels.push(roundItem.display_period || `${roundItem.month}월`);
      trendHistory.satisfaction.push(roundItem.course_satisfaction);
      trendHistory.nps.push(roundItem.nps);

      const instructorRows = [];
      roundItem.records.forEach(rec => {
        const inst = rec.instructor_name;
        const pastRecords = [];
        for (let i = 0; i <= idx; i++) {
          orderedRounds[i].records.forEach(pr => {
            if (pr.instructor_name === inst) pastRecords.push(pr);
          });
        }

        const count = pastRecords.length;
        const cumExpertise = count > 0 ? Number((pastRecords.reduce((sum, p) => sum + p.teaching_expertise, 0) / count).toFixed(3)) : rec.teaching_expertise;
        const cumDelivery = count > 0 ? Number((pastRecords.reduce((sum, p) => sum + p.delivery_skill, 0) / count).toFixed(3)) : rec.delivery_skill;
        const cumPractical = count > 0 ? Number((pastRecords.reduce((sum, p) => sum + p.practical_use, 0) / count).toFixed(3)) : rec.practical_use;
        const cumTextbook = count > 0 ? Number((pastRecords.reduce((sum, p) => sum + p.textbook_quality, 0) / count).toFixed(3)) : rec.textbook_quality;

        const currKey = `${courseName}_${inst}`;
        const curriculumText = this.curriculums[currKey] || `과정: ${courseName}\n강의시간: ${rec.hours}시간`;

        instructorRows.push({
          instructor_name: inst,
          curriculum: curriculumText,
          hours: rec.hours,
          current: {
            teaching_expertise: rec.teaching_expertise,
            delivery_skill: rec.delivery_skill,
            practical_use: rec.practical_use,
            textbook_quality: rec.textbook_quality
          },
          cumulative: {
            teaching_expertise: cumExpertise,
            delivery_skill: cumDelivery,
            practical_use: cumPractical,
            textbook_quality: cumTextbook
          }
        });
      });

      const compKeys = ["정보", "절차", "운영", "환경", "일정", "기타"];
      const compVals = compKeys.map(k => roundItem.records.reduce((s, r) => s + (r.complaints?.[k] || 0), 0));

      const formKeys = ["오프라인", "비대면", "이러닝", "플립러닝"];
      const formVals = formKeys.map(k => roundItem.records.reduce((s, r) => s + (r.preferred_formats?.[k] || 0), 0));

      const posKeys = ["사원", "대리", "과장", "차장", "부팀장", "임원"];
      const posVals = posKeys.map(k => roundItem.records.reduce((s, r) => s + (r.positions?.[k] || 0), 0));

      const motKeys = ["SNS", "이메일", "홈페이지", "인쇄물", "인터넷", "담당자추천", "동료추천", "기타"];
      const motVals = motKeys.map(k => roundItem.records.reduce((s, r) => s + (r.motives?.[k] || 0), 0));

      const commentKey = `${courseName}_${roundItem.schedule_raw}_${instructorName || 'all'}`;
      const roundComments = this.comments[commentKey] || {
        instructor_feedback: [],
        content_feedback: [],
        operation_feedback: [],
        recommend_feedback: [],
        additional_courses: []
      };

      let sheetTitle = roundItem.month ? `${roundItem.month}월` : `${idx+1}차`;
      const existingTitles = sheetDataList.map(s => s.sheet_title);
      if (existingTitles.includes(sheetTitle)) {
        sheetTitle = `${sheetTitle}(${roundItem.round_name || idx+1})`;
      }

      sheetDataList.push({
        sheet_title: sheetTitle,
        schedule_raw: roundItem.schedule_raw,
        display_period: roundItem.display_period,
        respondent_count: roundItem.respondent_count,
        course_name: courseName,
        instructors: instructorRows,
        charts: {
          chart0_satisfaction_trend: { categories: [...trendHistory.labels], values: [...trendHistory.satisfaction] },
          chart1_nps_trend: { categories: [...trendHistory.labels], values: [...trendHistory.nps] },
          chart2_complaints: { categories: compKeys, values: compVals },
          chart3_preferred_format: { categories: formKeys, values: formVals },
          chart4_positions: { categories: posKeys, values: posVals },
          chart5_motives: { categories: motKeys, values: motVals },
        },
        comments: roundComments,
        comment_key: commentKey
      });
    });

    return {
      course_name: courseName,
      instructor_name: instructorName,
      mode: mode,
      sheets: sheetDataList
    };
  }

  async saveComments(commentKey, commentsObj) {
    this.comments[commentKey] = commentsObj;
    await this.saveToDB('custom_comments', this.comments);
  }

  async saveCurriculum(courseName, instructorName, text) {
    const key = `${courseName}_${instructorName}`;
    this.curriculums[key] = text;
    await this.saveToDB('custom_curriculums', this.curriculums);
  }

  // 지능형 엑셀 파일 파싱 및 병합 (지능형 헤더 감지)
  async parseAndMergeExcel(file) {
    if (!window.XLSX) {
      throw new Error('SheetJS(XLSX) 라이브러리가 로드되지 않았습니다.');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

          if (!rows || rows.length < 2) {
            throw new Error('엑셀 파일에 유효한 데이터가 없습니다.');
          }

          // 1. 헤더 행 위치 지능형 탐색
          let headerRowIdx = -1;
          let colMap = {};

          for (let r = 0; r < Math.min(10, rows.length); r++) {
            const rowStr = rows[r].map(cell => String(cell || '').trim());
            // '과정명' 또는 '과정' 또는 '일정' 또는 '강사'가 들어간 행 찾기
            if (rowStr.some(v => v.includes('과정명') || v.includes('과정정보'))) {
              headerRowIdx = r;
              // 만약 바로 다음 행에 세부 헤더('과정명', '교육일정', '강사명' 등)가 있다면 다음 행 사용
              if (r + 1 < rows.length) {
                const nextRowStr = rows[r + 1].map(c => String(c || '').trim());
                if (nextRowStr.some(v => v.includes('과정명') || v.includes('교육일정') || v.includes('강사명'))) {
                  headerRowIdx = r + 1;
                }
              }
              break;
            }
          }

          if (headerRowIdx === -1) {
            // 헤더를 못 찾았을 경우 기본 2행(index 1) 또는 3행(index 2) 가정
            headerRowIdx = (rows.length > 2 && rows[1].some(c => String(c).includes('과정') || String(c).includes('일정'))) ? 1 : 0;
          }

          const headerRow = rows[headerRowIdx].map(c => String(c || '').trim());
          headerRow.forEach((colName, idx) => {
            if (colName) colMap[colName] = idx;
          });

          // 컬럼 인덱스 헬퍼
          const findCol = (keywords, defaultIdx) => {
            for (const [name, idx] of Object.entries(colMap)) {
              for (const kw of keywords) {
                if (name.includes(kw)) return idx;
              }
            }
            return defaultIdx;
          };

          const idxCourse = findCol(['과정명', '과정'], 0);
          const idxSched = findCol(['교육일정', '일정', '차수'], 1);
          const idxRegion = findCol(['지역'], 2);
          const idxInst = findCol(['강사명', '강사'], 3);
          const idxHours = findCol(['강의시간', '시간'], 4);
          const idxSent = findCol(['발송수'], 5);
          const idxResp = findCol(['응답수'], 6);
          const idxNps = findCol(['추천지수', 'NPS'], 7);
          const idxCourseSat = findCol(['과정만족도'], 8);
          const idxInstSat = findCol(['만족도평균'], 9);
          const idxExpertise = findCol(['강의전문성', '강의내용'], 10);
          const idxDelivery = findCol(['전달능력'], 11);
          const idxPractical = findCol(['교육효과성', '실무활용도'], 12);
          const idxTextbook = findCol(['교재완성도'], 13);

          const newRecords = [];
          for (let r = headerRowIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row[idxCourse]) continue;

            const courseName = String(row[idxCourse]).trim();
            if (!courseName || courseName === '과정명') continue;

            const schedRaw = String(row[idxSched] || '').trim();
            const region = String(row[idxRegion] || '').trim();
            const instName = String(row[idxInst] || '').trim();

            const parsedSched = this.parseSchedule(schedRaw);

            newRecords.push({
              course_name: courseName,
              schedule_raw: schedRaw,
              start_date: parsedSched.start_date,
              end_date: parsedSched.end_date,
              month: parsedSched.month,
              round_name: parsedSched.round_name,
              display_period: parsedSched.display_period,
              region: region,
              instructor_name: instName,
              hours: parseInt(row[idxHours]) || 0,
              sent_count: parseInt(row[idxSent]) || 0,
              respondent_count: parseInt(row[idxResp]) || 0,
              nps: parseFloat(row[idxNps]) || 0,
              course_satisfaction: parseFloat(row[idxCourseSat]) || 0,
              instructor_satisfaction_avg: parseFloat(row[idxInstSat]) || 0,
              teaching_expertise: parseFloat(row[idxExpertise]) || 0,
              delivery_skill: parseFloat(row[idxDelivery]) || 0,
              practical_use: parseFloat(row[idxPractical]) || 0,
              textbook_quality: parseFloat(row[idxTextbook]) || 0,
              complaints: {
                "정보": parseInt(row[14]) || 0,
                "절차": parseInt(row[15]) || 0,
                "운영": parseInt(row[16]) || 0,
                "환경": parseInt(row[17]) || 0,
                "일정": parseInt(row[18]) || 0,
                "기타": parseInt(row[19]) || 0,
              },
              motives: {
                "SNS": parseInt(row[20]) || 0,
                "이메일": parseInt(row[21]) || 0,
                "홈페이지": parseInt(row[22]) || 0,
                "인쇄물": parseInt(row[23]) || 0,
                "인터넷": parseInt(row[24]) || 0,
                "담당자추천": parseInt(row[25]) || 0,
                "동료추천": parseInt(row[26]) || 0,
                "기타": parseInt(row[27]) || 0,
              },
              positions: {
                "사원": parseInt(row[28]) || 0,
                "대리": parseInt(row[29]) || 0,
                "과장": parseInt(row[30]) || 0,
                "차장": parseInt(row[31]) || 0,
                "부팀장": parseInt(row[32]) || 0,
                "임원": parseInt(row[33]) || 0,
              },
              preferred_formats: {
                "오프라인": parseInt(row[34]) || 0,
                "비대면": parseInt(row[35]) || 0,
                "이러닝": parseInt(row[36]) || 0,
                "플립러닝": parseInt(row[37]) || 0,
              }
            });
          }

          if (newRecords.length === 0) {
            throw new Error('유효한 데이터 행을 추출하지 못했습니다. 파일 구조를 확인해 주세요.');
          }

          // 기존 추가 레코드와 병합
          const existingExtra = (await this.getFromDB('custom_records')) || [];
          const recordMap = new Map();
          existingExtra.forEach(r => recordMap.set(`${r.course_name}_${r.schedule_raw}_${r.instructor_name}`, r));
          newRecords.forEach(r => recordMap.set(`${r.course_name}_${r.schedule_raw}_${r.instructor_name}`, r));

          const mergedExtra = Array.from(recordMap.values());
          await this.saveToDB('custom_records', mergedExtra);

          // 메모리 상태 재동기화
          await this.init();
          resolve(newRecords.length);
        } catch (err) {
          console.error('parseAndMergeExcel error:', err);
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  }

  parseSchedule(s) {
    if (!s) return { start_date: '', end_date: '', month: 0, round_name: '', display_period: '' };
    const m = s.match(/\[\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*\]\s*(.*)/);
    if (m) {
      const [_, start_date, end_date, round_name] = m;
      const month = parseInt(start_date.split('-')[1]);
      return { start_date, end_date, month, round_name: round_name.trim(), display_period: `${start_date} ~ ${end_date}` };
    }
    const m2 = s.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
    if (m2) {
      const [_, start_date, end_date] = m2;
      const month = parseInt(start_date.split('-')[1]);
      return { start_date, end_date, month, round_name: '', display_period: `${start_date} ~ ${end_date}` };
    }
    return { start_date: '', end_date: '', month: 0, round_name: '', display_period: s };
  }

  // Base64 to ArrayBuffer 헬퍼
  base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  escapeXml(s) {
    return String(s != null ? s : '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  updateChartXml(xmlContent, categories, values, isRef = false, isFloat = false) {
    // Categories (X축)
    const ptsCat = (categories || []).map((c, i) => `<c:pt idx="${i}"><c:v>${this.escapeXml(c)}</c:v></c:pt>`).join('');
    if (isRef) {
      const newCat = `<c:strCache><c:ptCount val="${categories.length}"/>${ptsCat}</c:strCache>`;
      xmlContent = xmlContent.replace(/(<c:f>.*?<\/c:f>)\s*<c:strCache>.*?<\/c:strCache>/s, `$1${newCat}`);
      xmlContent = xmlContent.replace(/(<c16:filteredLitCache>)\s*<c:strCache>.*?<\/c:strCache>/s, `$1${newCat}`);
    } else {
      const newCat = `<c:strLit><c:ptCount val="${categories.length}"/>${ptsCat}</c:strLit>`;
      xmlContent = xmlContent.replace(/<c:strLit>.*?<\/c:strLit>/s, newCat);
    }

    // Values (Y축 수치)
    let ptsVal;
    let fmt;
    if (isFloat) {
      ptsVal = (values || []).map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v).toFixed(1)}</c:v></c:pt>`).join('');
      fmt = "0.0";
    } else {
      ptsVal = (values || []).map((v, i) => `<c:pt idx="${i}"><c:v>${Math.round(Number(v))}</c:v></c:pt>`).join('');
      fmt = "General";
    }

    if (isRef) {
      const newVal = `<c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${values.length}"/>${ptsVal}</c:numCache>`;
      xmlContent = xmlContent.replace(/(<c:f>.*?<\/c:f>)\s*<c:numCache>.*?<\/c:numCache>/s, `$1${newVal}`);
      xmlContent = xmlContent.replace(/(<c16:filteredLitCache>)\s*<c:numCache>.*?<\/c:numCache>/s, `$1${newVal}`);
    } else {
      const newVal = `<c:numLit><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${values.length}"/>${ptsVal}</c:numLit>`;
      xmlContent = xmlContent.replace(/<c:numLit>.*?<\/c:numLit>/s, newVal);
    }

    return xmlContent;
  }

  setCellValue(sheetXml, coord, value, isString = false) {
    const pattern = new RegExp(`(<c\\s+r="${coord}"[^>]*>)(.*?)(</c>)`, 's');
    const m = sheetXml.match(pattern);

    if (isString) {
      const valStr = this.escapeXml(value);
      const newContent = `<is><t>${valStr}</t></is>`;
      if (m) {
        let openTag = m[1].replace(/\s+t="[^"]*"/, '');
        openTag = openTag.slice(0, -1) + ' t="inlineStr">';
        return sheetXml.slice(0, m.index) + openTag + newContent + m[3] + sheetXml.slice(m.index + m[0].length);
      } else {
        const rowNum = coord.match(/\d+/)[0];
        const rowPattern = new RegExp(`(<row\\s+r="${rowNum}"[^>]*>)`, 's');
        const rm = sheetXml.match(rowPattern);
        if (rm) {
          const cellXml = `<c r="${coord}" t="inlineStr">${newContent}</c>`;
          const idx = rm.index + rm[0].length;
          return sheetXml.slice(0, idx) + cellXml + sheetXml.slice(idx);
        }
      }
    } else {
      let valNum;
      if (typeof value === 'number') {
        valNum = String(Number(value.toFixed(2)));
      } else {
        valNum = String(value != null ? value : '0');
      }
      const newContent = `<v>${valNum}</v>`;
      if (m) {
        let openTag = m[1].replace(/\s+t="[^"]*"/, '');
        return sheetXml.slice(0, m.index) + openTag + newContent + m[3] + sheetXml.slice(m.index + m[0].length);
      } else {
        const rowNum = coord.match(/\d+/)[0];
        const rowPattern = new RegExp(`(<row\\s+r="${rowNum}"[^>]*>)`, 's');
        const rm = sheetXml.match(rowPattern);
        if (rm) {
          const cellXml = `<c r="${coord}">${newContent}</c>`;
          const idx = rm.index + rm[0].length;
          return sheetXml.slice(0, idx) + cellXml + sheetXml.slice(idx);
        }
      }
    }

    return sheetXml;
  }

  // 원본 샘플 양식 및 6개 차트를 100% 무손실 복제하여 엑셀 생성 및 다운로드
  async downloadExcel(reportData) {
    const mode = reportData.mode || 'instructor';

    // 1. JSZip 기반 무손실 템플릿 엔진 시도
    if (window.JSZip) {
      try {
        let templateBuffer = null;

        // Base64 내장 템플릿 사용 (CORS 및 로컬 파일 완벽 지원)
        if (window.EXCEL_TEMPLATES) {
          const b64 = mode === 'instructor' ? window.EXCEL_TEMPLATES.instructor : window.EXCEL_TEMPLATES.course;
          if (b64) {
            templateBuffer = this.base64ToArrayBuffer(b64);
          }
        }

        // fetch 백업 시도
        if (!templateBuffer) {
          const path = mode === 'instructor' ? './templates_excel/template_instructor.xlsx' : './templates_excel/template_course.xlsx';
          try {
            const resp = await fetch(path);
            if (resp.ok) {
              templateBuffer = await resp.arrayBuffer();
            }
          } catch (e) {
            console.warn('Failed to fetch template:', e);
          }
        }

        if (templateBuffer) {
          const zip = await JSZip.loadAsync(templateBuffer);

          // 1번 시트 원형 추출
          const baseSheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
          const baseSheetRels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');
          const baseDrawingXml = await zip.file('xl/drawings/drawing1.xml').async('string');
          const baseDrawingRels = await zip.file('xl/drawings/_rels/drawing1.xml.rels').async('string');

          const baseChartsXml = [];
          for (let c = 1; c <= 6; c++) {
            baseChartsXml.push(await zip.file(`xl/charts/chart${c}.xml`).async('string'));
          }

          // 기존 시트/드로잉/차트 파일 정리
          const removeKeys = [];
          zip.forEach((path) => {
            if (path.startsWith('xl/worksheets/') || path.startsWith('xl/drawings/') || path.startsWith('xl/charts/')) {
              removeKeys.push(path);
            }
          });
          removeKeys.forEach(k => zip.remove(k));

          const sheets = reportData.sheets || [];
          const sheetEntries = [];
          const wbRelsEntries = [];
          const usedTitles = new Set();

          sheets.forEach((sdata, sIdx) => {
            const sheetNum = sIdx + 1;
            const drawingNum = sIdx + 1;
            const startChartNum = sIdx * 6 + 1;

            // 1. 시트 내용 패치
            let sXml = baseSheetXml;
            sXml = this.setCellValue(sXml, 'B5', sdata.course_name || '', true);
            sXml = this.setCellValue(sXml, 'G5', sdata.display_period || '', true);
            sXml = this.setCellValue(sXml, 'I5', sdata.respondent_count || 0, false);

            const instructors = sdata.instructors || [];
            if (instructors.length > 0) {
              const inst0 = instructors[0];
              sXml = this.setCellValue(sXml, 'B10', inst0.instructor_name || '', true);
              sXml = this.setCellValue(sXml, 'C10', inst0.curriculum || '', true);
              sXml = this.setCellValue(sXml, 'B11', inst0.hours || '', true);

              const cur = inst0.current || {};
              const cum = inst0.cumulative || {};
              sXml = this.setCellValue(sXml, 'F10', cur.teaching_expertise || 0, false);
              sXml = this.setCellValue(sXml, 'G10', cur.delivery_skill || 0, false);
              sXml = this.setCellValue(sXml, 'H10', cur.practical_use || 0, false);
              sXml = this.setCellValue(sXml, 'I10', cur.textbook_quality || 0, false);

              sXml = this.setCellValue(sXml, 'F11', cum.teaching_expertise || 0, false);
              sXml = this.setCellValue(sXml, 'G11', cum.delivery_skill || 0, false);
              sXml = this.setCellValue(sXml, 'H11', cum.practical_use || 0, false);
              sXml = this.setCellValue(sXml, 'I11', cum.textbook_quality || 0, false);
            }

            // 주관식 후기 반영
            const comments = sdata.comments || {};
            if (mode === 'instructor') {
              const instF = comments.instructor_feedback || [];
              const contF = comments.content_feedback || [];
              const recF = comments.recommend_feedback || [];
              for (let i = 0; i < 4; i++) {
                sXml = this.setCellValue(sXml, `E${61 + i}`, instF[i] || '', true);
                sXml = this.setCellValue(sXml, `E${65 + i}`, contF[i] || '', true);
                sXml = this.setCellValue(sXml, `E${69 + i}`, recF[i] || '', true);
              }
            } else {
              const instF = comments.instructor_feedback || [];
              const contF = comments.content_feedback || [];
              const operF = comments.operation_feedback || [];
              const recF = comments.recommend_feedback || [];
              const addF = comments.additional_courses || [];
              sXml = this.setCellValue(sXml, 'E61', instF[0] || '', true);
              sXml = this.setCellValue(sXml, 'E62', instF[1] || '', true);
              sXml = this.setCellValue(sXml, 'E63', contF[0] || '', true);
              sXml = this.setCellValue(sXml, 'E64', operF[0] || '', true);
              sXml = this.setCellValue(sXml, 'E65', recF[0] || '', true);
              sXml = this.setCellValue(sXml, 'E66', recF[1] || '', true);
              sXml = this.setCellValue(sXml, 'E67', recF[2] || '', true);
              sXml = this.setCellValue(sXml, 'E68', addF[0] || '', true);
            }

            zip.file(`xl/worksheets/sheet${sheetNum}.xml`, sXml);

            // 2. Sheet Rels
            const sRels = baseSheetRels.replace('drawing1.xml', `drawing${drawingNum}.xml`);
            zip.file(`xl/worksheets/_rels/sheet${sheetNum}.xml.rels`, sRels);

            // 3. Drawing XML
            zip.file(`xl/drawings/drawing${drawingNum}.xml`, baseDrawingXml);

            // 4. Drawing Rels
            let dRels = baseDrawingRels;
            for (let c = 0; c < 6; c++) {
              dRels = dRels.replace(`../charts/chart${c + 1}.xml`, `../charts/chart${startChartNum + c}.xml`);
            }
            zip.file(`xl/drawings/_rels/drawing${drawingNum}.xml.rels`, dRels);

            // 5. 6개 차트 주입
            const chartsData = sdata.charts || {};
            const chartDefs = [
              [chartsData.chart0_satisfaction_trend, true, true],
              [chartsData.chart1_nps_trend, true, true],
              [chartsData.chart2_complaints, false, false],
              [chartsData.chart3_preferred_format, false, false],
              [chartsData.chart4_positions, false, false],
              [chartsData.chart5_motives, false, false],
            ];

            chartDefs.forEach(([cData, isRef, isFloat], cIdx) => {
              let cXml = baseChartsXml[cIdx];
              if (cData && cData.categories && cData.values) {
                cXml = this.updateChartXml(cXml, cData.categories, cData.values, isRef, isFloat);
              }
              zip.file(`xl/charts/chart${startChartNum + cIdx}.xml`, cXml);
            });

            // 시트명 처리
            let rawTitle = sdata.sheet_title || `${sheetNum}차`;
            let cleanTitle = rawTitle.replace(/[\/\\?*\[\]:]/g, '_').substring(0, 30);
            if (usedTitles.has(cleanTitle)) {
              cleanTitle = `${cleanTitle}_${sheetNum}`.substring(0, 30);
            }
            usedTitles.add(cleanTitle);

            sheetEntries.push(`<sheet name="${this.escapeXml(cleanTitle)}" sheetId="${sheetNum}" r:id="rId${sheetNum}"/>`);
            wbRelsEntries.push(`<Relationship Id="rId${sheetNum}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNum}.xml"/>`);
          });

          // 6. xl/workbook.xml 갱신
          let wbXml = await zip.file('xl/workbook.xml').async('string');
          wbXml = wbXml.replace(/<sheets>.*?<\/sheets>/s, `<sheets>${sheetEntries.join('')}</sheets>`);
          wbXml = wbXml.replace(/<definedNames>.*?<\/definedNames>/s, '');
          zip.file('xl/workbook.xml', wbXml);

          // 7. xl/_rels/workbook.xml.rels 갱신
          let wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
          const otherRelsMatches = wbRels.match(/<Relationship\s+[^>]*\/>/g) || [];
          const otherRels = otherRelsMatches.filter(r => !r.includes('relationships/worksheet'));
          const allWbRels = otherRels.join('') + wbRelsEntries.join('');
          wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${allWbRels}</Relationships>`;
          zip.file('xl/_rels/workbook.xml.rels', wbRels);

          // 8. [Content_Types].xml 갱신
          let ctXml = await zip.file('[Content_Types].xml').async('string');
          ctXml = ctXml.replace(/<Override\s+PartName="\/xl\/(worksheets|drawings|charts)\/[^>]*\/>/g, '');
          const newOverrides = [];
          sheets.forEach((_, sIdx) => {
            const sheetNum = sIdx + 1;
            newOverrides.push(`<Override PartName="/xl/worksheets/sheet${sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
            newOverrides.push(`<Override PartName="/xl/drawings/drawing${sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
            for (let c = 1; c <= 6; c++) {
              const cNum = sIdx * 6 + c;
              newOverrides.push(`<Override PartName="/xl/charts/chart${cNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
            }
          });
          ctXml = ctXml.replace('</Types>', newOverrides.join('') + '</Types>');
          zip.file('[Content_Types].xml', ctXml);

          // 9. 다운로드 생성
          const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            compression: 'DEFLATE'
          });

          const targetName = mode === 'instructor' && reportData.instructor_name 
            ? `${reportData.course_name}(${reportData.instructor_name})_강사별만족도` 
            : `${reportData.course_name}_교육운영결과보고서`;
          const cleanTarget = targetName.replace(/[\\/*?:\[\]]/g, '_');
          const filename = `${cleanTarget}.xlsx`;

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          return;
        }
      } catch (err) {
        console.error('JSZip generation failed, falling back to ExcelJS:', err);
      }
    }

    // 2. JSZip 미지원 환경 백업: ExcelJS
    if (!window.ExcelJS) {
      throw new Error('엑셀 생성 라이브러리가 로드되지 않았습니다.');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KPC 한국생산성본부';
    workbook.created = new Date();

    const sheets = reportData.sheets || [];
    sheets.forEach((sdata, sIdx) => {
      const sheetTitle = (sdata.sheet_title || `${sIdx+1}차`).replace(/[\\/*?:\[\]]/g, '_').substring(0, 30);
      const ws = workbook.addWorksheet(sheetTitle);

      ws.columns = [
        { width: 4 },   // A
        { width: 14 },  // B (강사, 구분)
        { width: 28 },  // C (커리큘럼)
        { width: 10 },  // D (구분)
        { width: 12 },  // E (이번/누적 차수)
        { width: 12 },  // F (강의내용)
        { width: 12 },  // G (전달능력)
        { width: 12 },  // H (실무활용도)
        { width: 14 },  // I (교재완성도)
      ];

      const thinBorder = {
        top: { style: 'thin', color: { argb: 'FF7F7F7F' } },
        left: { style: 'thin', color: { argb: 'FF7F7F7F' } },
        bottom: { style: 'thin', color: { argb: 'FF7F7F7F' } },
        right: { style: 'thin', color: { argb: 'FF7F7F7F' } }
      };

      // R2: 대제목
      ws.mergeCells('B2:I2');
      const titleCell = ws.getCell('B2');
      titleCell.value = '교육 운영 결과 보고서';
      titleCell.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: 'FF000000' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getRow(2).height = 20;

      // R4: 개요 헤더
      ws.mergeCells('B4:F4');
      ws.getCell('B4').value = '과정명';
      ws.mergeCells('G4:H4');
      ws.getCell('G4').value = '일정';
      ws.getCell('I4').value = '설문인원';

      ['B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4'].forEach(addr => {
        const c = ws.getCell(addr);
        c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = thinBorder;
      });

      // R5: 개요 데이터
      ws.mergeCells('B5:F5');
      ws.getCell('B5').value = sdata.course_name;
      ws.mergeCells('G5:H5');
      ws.getCell('G5').value = sdata.display_period;
      ws.getCell('I5').value = sdata.respondent_count;

      ['B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'I5'].forEach(addr => {
        const c = ws.getCell(addr);
        c.font = { name: '맑은 고딕', size: (addr === 'G5' ? 9 : 10), bold: false };
        c.alignment = { vertical: 'middle', horizontal: (addr === 'B5' ? 'center' : 'center') };
        c.border = thinBorder;
      });
      ws.getRow(5).height = 18;

      // R7: 1. 설문 결과 분석 바
      ws.mergeCells('B7:I7');
      const sec1 = ws.getCell('B7');
      sec1.value = '1. 설문 결과 분석';
      sec1.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };
      sec1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      sec1.alignment = { vertical: 'middle', horizontal: 'center' };
      sec1.border = thinBorder;

      // R8: ① 설문결과 / 5점
      const sec1Sub = ws.getCell('B8');
      sec1Sub.value = '① 설문결과 / 5점';
      sec1Sub.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };

      // R9: 테이블 헤더
      ws.getCell('B9').value = '강사';
      ws.mergeCells('C9:E9');
      ws.getCell('C9').value = '커리큘럼';
      ws.getCell('F9').value = '강의내용';
      ws.getCell('G9').value = '전달능력';
      ws.getCell('H9').value = '실무활용도';
      ws.getCell('I9').value = '교재완성도';

      ['B9', 'C9', 'D9', 'E9', 'F9', 'G9', 'H9', 'I9'].forEach(addr => {
        const c = ws.getCell(addr);
        c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = thinBorder;
      });

      // R10 & R11: 점수 데이터
      const inst0 = (sdata.instructors && sdata.instructors[0]) || {};
      const cur = inst0.current || {};
      const cum = inst0.cumulative || {};

      ws.getCell('B10').value = inst0.instructor_name || '';
      ws.getCell('B11').value = inst0.hours || '';
      ws.mergeCells('C10:D11');
      ws.getCell('C10').value = inst0.curriculum || '';

      ws.getCell('E10').value = '이번\n차수';
      ws.getCell('F10').value = cur.teaching_expertise || 0;
      ws.getCell('G10').value = cur.delivery_skill || 0;
      ws.getCell('H10').value = cur.practical_use || 0;
      ws.getCell('I10').value = cur.textbook_quality || 0;

      ws.getCell('E11').value = '누적\n차수';
      ws.getCell('F11').value = cum.teaching_expertise || 0;
      ws.getCell('G11').value = cum.delivery_skill || 0;
      ws.getCell('H11').value = cum.practical_use || 0;
      ws.getCell('I11').value = cum.textbook_quality || 0;

      ['B10', 'B11', 'C10', 'D10', 'C11', 'D11', 'E10', 'F10', 'G10', 'H10', 'I10', 'E11', 'F11', 'G11', 'H11', 'I11'].forEach(addr => {
        const c = ws.getCell(addr);
        c.font = { name: '맑은 고딕', size: 10 };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        c.border = thinBorder;
      });
      ws.getCell('C10').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

      // R60: 2. 이번 교육 운영 결과표
      ws.mergeCells('B60:I60');
      const sec2 = ws.getCell('B60');
      sec2.value = '2. 이번 교육 운영 결과표';
      sec2.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };
      sec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      sec2.alignment = { vertical: 'middle', horizontal: 'center' };
      sec2.border = thinBorder;

      const comments = sdata.comments || {};
      const instF = comments.instructor_feedback || [];
      const contF = comments.content_feedback || [];
      const recF = comments.recommend_feedback || [];

      // 3개 섹션 + '긍정' 배지
      const addSection = (rStart, title, items) => {
        ws.mergeCells(`B${rStart}:C${rStart + 3}`);
        const tCell = ws.getCell(`B${rStart}`);
        tCell.value = title;
        tCell.font = { name: '맑은 고딕', size: 10, bold: true };
        tCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        tCell.border = thinBorder;

        for (let i = 0; i < 4; i++) {
          const row = rStart + i;
          const posCell = ws.getCell(`D${row}`);
          posCell.value = '긍정';
          posCell.font = { name: '맑은 고딕', size: 11, bold: false, color: { argb: 'FF006100' } };
          posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
          posCell.alignment = { vertical: 'middle', horizontal: 'center' };
          posCell.border = thinBorder;

          ws.mergeCells(`E${row}:I${row}`);
          const valCell = ws.getCell(`E${row}`);
          valCell.value = items[i] || '';
          valCell.font = { name: '맑은 고딕', size: 10 };
          valCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
          valCell.border = thinBorder;
        }
      };

      addSection(61, '  강사님 관련 의견', instF);
      addSection(65, '  교육 내용 관련 의견', contF);
      addSection(69, '  본 교육과정 추천 시 추천 사유', recF);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const targetName = mode === 'instructor' && reportData.instructor_name 
      ? `${reportData.course_name}(${reportData.instructor_name})_강사별만족도` 
      : `${reportData.course_name}_교육운영결과보고서`;
    const cleanTarget = targetName.replace(/[\\/*?:\[\]]/g, '_');
    const filename = `${cleanTarget}.xlsx`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }
}

window.clientEngine = new ClientEngine();
