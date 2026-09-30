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
    let deletedCourses = [];

    try {
      this.db = await this.openIndexedDB();
      extraRecords = (await this.getFromDB('custom_records')) || [];
      extraComments = (await this.getFromDB('custom_comments')) || {};
      extraCurriculums = (await this.getFromDB('custom_curriculums')) || {};
      deletedCourses = (await this.getFromDB('deleted_courses')) || [];
    } catch (e) {
      console.warn('IndexedDB unavailable, falling back to LocalStorage:', e);
      try {
        extraRecords = JSON.parse(localStorage.getItem('kpc_custom_records') || '[]');
        extraComments = JSON.parse(localStorage.getItem('kpc_custom_comments') || '{}');
        extraCurriculums = JSON.parse(localStorage.getItem('kpc_custom_curriculums') || '{}');
        deletedCourses = JSON.parse(localStorage.getItem('kpc_deleted_courses') || '[]');
      } catch (err) {}
    }

    // 3. 레코드 병합 (과정명_일정_강사명 기준 중복 방지, 삭제된 과정 제외)
    const deletedSet = new Set(deletedCourses);
    const recordMap = new Map();
    defaultRecords.forEach(r => {
      if (!deletedSet.has(r.course_name)) {
        recordMap.set(`${r.course_name}_${r.schedule_raw}_${r.instructor_name}`, r);
      }
    });
    extraRecords.forEach(r => {
      if (!deletedSet.has(r.course_name)) {
        recordMap.set(`${r.course_name}_${r.schedule_raw}_${r.instructor_name}`, r);
      }
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

  deleteFromDB(key) {
    return new Promise((resolve) => {
      if (!this.db) {
        try {
          localStorage.removeItem(`kpc_${key}`);
          resolve();
        } catch (e) {
          resolve();
        }
        return;
      }
      try {
        const tx = this.db.transaction('store', 'readwrite');
        tx.objectStore('store').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  // 업로드된 데이터 초기화 (기본 내장 데이터로 복원)
  async resetUploadedData() {
    await this.deleteFromDB('custom_records');
    await this.deleteFromDB('deleted_courses');
    await this.init();
    return this.records.length;
  }

  // 특정 과정 데이터 삭제
  async deleteCourse(courseName) {
    if (!courseName) return this.records.length;

    // 1. 메모리 레코드에서 제거
    this.records = this.records.filter(r => r.course_name !== courseName);

    // 2. custom_records에서 제거 후 저장
    const customRecords = (await this.getFromDB('custom_records')) || [];
    const updatedCustom = customRecords.filter(r => r.course_name !== courseName);
    await this.saveToDB('custom_records', updatedCustom);

    // 3. deleted_courses에 추가 (기본 내장 데이터에서도 제외되도록)
    const deletedCourses = (await this.getFromDB('deleted_courses')) || [];
    if (!deletedCourses.includes(courseName)) {
      deletedCourses.push(courseName);
      await this.saveToDB('deleted_courses', deletedCourses);
    }

    // 4. 주관식 의견 및 커리큘럼 정리
    for (const k in this.comments) {
      if (k.startsWith(courseName + '_')) {
        delete this.comments[k];
      }
    }
    await this.saveToDB('custom_comments', this.comments);

    for (const k in this.curriculums) {
      if (k.startsWith(courseName + '_')) {
        delete this.curriculums[k];
      }
    }
    await this.saveToDB('custom_curriculums', this.curriculums);

    return this.records.length;
  }

  // 전체 데이터 완전 비우기 (0건 상태)
  async clearAllData() {
    const defaultCourses = (window.DEFAULT_SURVEY_RECORDS || []).map(r => r.course_name);
    const currentCourses = (this.records || []).map(r => r.course_name);
    const allCourses = Array.from(new Set([...defaultCourses, ...currentCourses]));
    
    await this.saveToDB('deleted_courses', allCourses);
    await this.saveToDB('custom_records', []);
    await this.saveToDB('custom_comments', {});
    await this.saveToDB('custom_curriculums', {});
    
    this.records = [];
    this.comments = {};
    this.curriculums = {};
    return 0;
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

      // 5점 만점 정상 만족도 우선 채택
      const sat = r.course_satisfaction;
      if ((sat >= 1.0 && sat <= 5.0) || item.course_satisfaction === 0) {
        item.course_satisfaction = sat;
      }

      // NPS 정상값 채택
      const nVal = r.nps;
      if (nVal > 10.0 || nVal < 0 || item.nps === 0) {
        item.nps = nVal;
      }
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

      // 복수 강사 시 공통 설문 데이터 중복 합산 방지 -> 대표 레코드 사용
      const primaryRec = roundItem.records[0] || {};
      const compKeys = ["정보", "절차", "운영", "환경", "일정", "기타"];
      const compVals = compKeys.map(k => primaryRec.complaints?.[k] || 0);

      const formKeys = ["오프라인", "비대면", "이러닝", "플립러닝"];
      const formVals = formKeys.map(k => primaryRec.preferred_formats?.[k] || 0);

      const posKeys = ["사원", "대리", "과장", "차장", "부팀장", "임원"];
      const posVals = posKeys.map(k => primaryRec.positions?.[k] || 0);

      const motKeys = ["SNS", "이메일", "홈페이지", "인쇄물", "인터넷", "담당자추천", "동료추천", "기타"];
      const motVals = motKeys.map(k => primaryRec.motives?.[k] || 0);

      const commentKey = `${courseName}_${roundItem.schedule_raw}_${instructorName || 'all'}`;
      let roundComments = this.comments[commentKey];

      // 주관식 공통 의견 자동 연동 (내용의견, 추천사유 상호 참조)
      const altKey = instructorName ? `${courseName}_${roundItem.schedule_raw}_all` : (roundItem.records[0] ? `${courseName}_${roundItem.schedule_raw}_${roundItem.records[0].instructor_name}` : null);
      const altComments = altKey ? this.comments[altKey] : null;

      if (!roundComments) {
        roundComments = {
          instructor_feedback: altComments?.instructor_feedback ? [...altComments.instructor_feedback] : [],
          content_feedback: altComments?.content_feedback ? [...altComments.content_feedback] : [],
          operation_feedback: altComments?.operation_feedback ? [...altComments.operation_feedback] : [],
          recommend_feedback: altComments?.recommend_feedback ? [...altComments.recommend_feedback] : [],
          additional_courses: altComments?.additional_courses ? [...altComments.additional_courses] : [],
          instructor_sentiment: altComments?.instructor_sentiment ? [...altComments.instructor_sentiment] : [],
          content_sentiment: altComments?.content_sentiment ? [...altComments.content_sentiment] : [],
          recommend_sentiment: altComments?.recommend_sentiment ? [...altComments.recommend_sentiment] : []
        };
      } else if (altComments) {
        if ((!roundComments.content_feedback || roundComments.content_feedback.length === 0) && altComments.content_feedback?.length) {
          roundComments.content_feedback = [...altComments.content_feedback];
        }
        if ((!roundComments.recommend_feedback || roundComments.recommend_feedback.length === 0) && altComments.recommend_feedback?.length) {
          roundComments.recommend_feedback = [...altComments.recommend_feedback];
        }
      }

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

    // 양방향 동기화: 공통 의견(교육내용, 추천사유) 자동 연동
    const parts = commentKey.split('_');
    if (parts.length >= 3) {
      const target = parts[parts.length - 1];
      const prefix = parts.slice(0, parts.length - 1).join('_');

      if (target === 'all') {
        for (const k in this.comments) {
          if (k.startsWith(prefix + '_') && k !== commentKey) {
            this.comments[k] = this.comments[k] || {};
            if (commentsObj.content_feedback?.length) {
              this.comments[k].content_feedback = [...commentsObj.content_feedback];
            }
            if (commentsObj.recommend_feedback?.length) {
              this.comments[k].recommend_feedback = [...commentsObj.recommend_feedback];
            }
          }
        }
      } else {
        const allKey = `${prefix}_all`;
        this.comments[allKey] = this.comments[allKey] || {};
        if (commentsObj.content_feedback?.length) {
          this.comments[allKey].content_feedback = [...commentsObj.content_feedback];
        }
        if (commentsObj.recommend_feedback?.length) {
          this.comments[allKey].recommend_feedback = [...commentsObj.recommend_feedback];
        }
      }
    }

    await this.saveToDB('custom_comments', this.comments);
  }

  async saveCurriculum(courseName, instructorName, text) {
    const key = `${courseName}_${instructorName}`;
    this.curriculums[key] = text;
    await this.saveToDB('custom_curriculums', this.curriculums);
  }

  // 지능형 엑셀 파일 파싱 및 병합 (지능형 헤더 감지)
  // 지능형 엑셀 파일 파싱 및 병합 (지능형 복합 헤더 감지, 제외어 필터, 값 기반 자가 치유)
  async parseAndMergeExcel(file, replaceMode = false) {
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

          // 1. 헤더 행 위치 지능형 탐색 (상위 15행 스캔하여 헤더 매칭 점수 계산)
          let bestHeaderRowIdx = -1;
          let maxScore = -1;
          const headerKeywords = ['과정명', '과정', '과정정보', '교육일정', '일정', '강사명', '강사', '발송수', '응답수', '과정만족도', '추천지수', '만족도평균', '교재완성도'];

          for (let r = 0; r < Math.min(15, rows.length); r++) {
            const rowStr = rows[r].map(cell => String(cell || '').trim());
            let score = 0;
            rowStr.forEach(val => {
              if (!val) return;
              headerKeywords.forEach(kw => {
                if (val === kw) score += 3;
                else if (val.includes(kw)) score += 1;
              });
            });
            if (score > maxScore) {
              maxScore = score;
              bestHeaderRowIdx = r;
            }
          }

          if (bestHeaderRowIdx === -1 || maxScore < 2) {
            bestHeaderRowIdx = (rows.length > 2 && rows[1].some(c => String(c).includes('과정') || String(c).includes('일정'))) ? 1 : 0;
          }

          // 2단 복합 헤더 구조 완벽 대응 (상위 행 + 하위 행 결합 맵)
          const numCols = Math.max(...rows.slice(0, Math.min(15, rows.length)).map(r => r.length));
          const colHeaders = [];

          for (let c = 0; c < numCols; c++) {
            let top = bestHeaderRowIdx > 0 ? String(rows[bestHeaderRowIdx - 1]?.[c] || '').trim() : '';
            let bot = String(rows[bestHeaderRowIdx]?.[c] || '').trim();

            // 상위 셀이 병합되어 비어있을 경우 좌측 값 전파 (수평 병합 헤더 대응)
            if (!top && bestHeaderRowIdx > 0) {
              for (let leftC = c - 1; leftC >= 0; leftC--) {
                const prevTop = String(rows[bestHeaderRowIdx - 1]?.[leftC] || '').trim();
                if (prevTop && ['과정정보', '설문대상', '강사만족도', '불편사항', '선호 교육형태', '수강동기'].some(k => prevTop.includes(k))) {
                  top = prevTop;
                  break;
                }
              }
            }

            const combined = [top, bot].filter(Boolean).join('_');
            colHeaders.push({ col: c, top, bot, combined });
          }

          // 지능형 컬럼 탐색 헬퍼: 1순위 완전일치 -> 2순위 제외어 필터링 후 포함일치
          const findCol = ({ exact = [], contains = [], exclude = [], defaultIdx = -1 }) => {
            // 1단계: 완전 일치 (bot 또는 top 또는 combined 정확 일치)
            for (let c = 0; c < numCols; c++) {
              const h = colHeaders[c];
              for (const kw of exact) {
                if (h.bot === kw || h.top === kw || h.combined === kw) {
                  return c;
                }
              }
            }
            // 2단계: 제외어 검사 후 포함 일치
            for (const kw of contains) {
              for (let c = 0; c < numCols; c++) {
                const h = colHeaders[c];
                const text = h.combined;
                if (!text) continue;
                const hasExclude = exclude.some(ex => text.includes(ex));
                if (!hasExclude && text.includes(kw)) {
                  return c;
                }
              }
            }
            return defaultIdx;
          };

          const idxCourse = findCol({
            exact: ['과정명', '교육과정명', '과정'],
            contains: ['과정명', '교육과정', '과정'],
            exclude: ['코드', '번호', '정보', '유형', '구분', '시간', '만족도', '차수', '비용', '강사'],
            defaultIdx: 0
          });

          const idxSched = findCol({
            exact: ['교육일정(차수)', '교육일정', '일정(차수)', '교육기간', '연수기간'],
            contains: ['교육일정', '교육기간', '일정', '연수기간'],
            exclude: ['코드', '번호', '구분', '불편', '시간', '항목', '불편사항'],
            defaultIdx: 1
          });

          const idxRegion = findCol({
            exact: ['지역', '교육장소', '장소'],
            contains: ['지역', '장소', '캠퍼스'],
            exclude: ['코드', '번호'],
            defaultIdx: 2
          });

          const idxInst = findCol({
            exact: ['강사명', '교수명', '강사'],
            contains: ['강사명', '교수명', '강사'],
            exclude: ['코드', '번호', '만족도', '평균', '전문성', '전달', '강의', '료', '확정', '평가'],
            defaultIdx: 3
          });

          const idxHours = findCol({
            exact: ['강의시간', '교육시간', '시간'],
            contains: ['강의시간', '교육시간', '시간'],
            exclude: ['시작', '종료', '코드'],
            defaultIdx: 4
          });

          const idxSent = findCol({
            exact: ['발송수', '발송건수', '설문발송수'],
            contains: ['발송'],
            exclude: ['일정', '일자'],
            defaultIdx: 5
          });

          const idxResp = findCol({
            exact: ['응답수', '응답건수', '설문응답수', '설문인원', '참여인원'],
            contains: ['응답', '설문인원', '참여인원'],
            exclude: ['율', '비율'],
            defaultIdx: 6
          });

          const idxNps = findCol({
            exact: ['추천지수(NPS)', '추천지수', 'NPS', '순추천고객지수'],
            contains: ['추천지수', 'NPS', '순추천'],
            exclude: ['사유', '이유', '의견', '추천인', '동료추천', '담당자추천'],
            defaultIdx: 7
          });

          const idxCourseSat = findCol({
            exact: ['과정만족도', '교육과정만족도', '과정내용만족도', '과정만족'],
            contains: ['과정만족', '과정내용만족', '교육과정만족'],
            exclude: ['강사', '교재', '시설', '환경', '불편'],
            defaultIdx: 8
          });

          const idxInstSat = findCol({
            exact: ['만족도평균', '강사만족도평균', '강사만족도'],
            contains: ['만족도평균', '강사만족'],
            exclude: ['과정'],
            defaultIdx: 9
          });

          const idxExpertise = findCol({
            exact: ['강의전문성', '강의내용', '전문성'],
            contains: ['전문성', '강의내용'],
            exclude: ['코드'],
            defaultIdx: 10
          });

          const idxDelivery = findCol({
            exact: ['전달능력', '전달력', '강의전달'],
            contains: ['전달'],
            exclude: ['코드'],
            defaultIdx: 11
          });

          const idxPractical = findCol({
            exact: ['교육효과성', '실무활용도', '활용도', '실무적용도'],
            contains: ['실무활용', '교육효과', '활용도', '효과성'],
            exclude: ['코드'],
            defaultIdx: 12
          });

          const idxTextbook = findCol({
            exact: ['교재완성도', '교재만족도', '교재품질', '교재'],
            contains: ['교재완성', '교재품질', '교재'],
            exclude: ['코드', '번호', '과정코드'],
            defaultIdx: 13
          });

          // 2. 데이터 행 파싱 및 값 기반 자가 치유(Sanity Check & Auto-Healing)
          const newRecords = [];
          for (let r = bestHeaderRowIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row[idxCourse]) continue;

            let courseName = String(row[idxCourse]).trim();
            if (!courseName || courseName === '과정명' || courseName === '과정정보') continue;

            let schedRaw = String(row[idxSched] || '').trim();
            let region = String(row[idxRegion] || '').trim();
            let instName = String(row[idxInst] || '').trim();

            // [자가치유 1] 강사명과 교육일정이 뒤바뀐 경우(Swap) 감지 및 교정
            const isDateLike = (str) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(str) || /^\[\s*\d{4}/.test(str) || /^\d{5}(?:\.\d+)?$/.test(str);
            if (isDateLike(instName) && !isDateLike(schedRaw)) {
              const temp = schedRaw;
              schedRaw = instName;
              instName = temp;
            } else if (isDateLike(instName)) {
              // 강사명에 일정이 들어갔는데 schedRaw도 일정이면 인근 컬럼에서 강사 이름 탐색
              let foundInst = '';
              for (let c = 0; c < Math.min(10, row.length); c++) {
                if (c !== idxCourse && c !== idxSched) {
                  const val = String(row[c] || '').trim();
                  if (/^[가-힣]{2,4}$/.test(val) && !['서울', '부산', '대구', '대전', '광주', '인천', '울산', '경기', '온라인', '비대면'].includes(val)) {
                    foundInst = val;
                    break;
                  }
                }
              }
              instName = foundInst;
            }

            const parsedSched = this.parseSchedule(schedRaw);

            // [자가치유 2] 발송수, 응답수, 과정만족도, NPS 상호 오인식 자동 교정
            let rawSent = parseInt(row[idxSent]) || 0;
            let rawResp = parseInt(row[idxResp]) || 0;
            let rawNps = parseFloat(row[idxNps]) || 0;
            let rawSat = parseFloat(row[idxCourseSat]) || 0;

            // 5점 만점인 만족도가 5.0 초과인 경우 (예: 발송수 7이 만족도로 들어간 현상 교정)
            if (rawSat > 5.0) {
              // 7~13열 사이에서 1.0~5.0 사이의 실수값(실제 만족도) 탐색
              let realSat = 0;
              for (let c = 7; c <= 13; c++) {
                const v = parseFloat(row[c]);
                if (!isNaN(v) && v >= 1.0 && v <= 5.0) {
                  realSat = v;
                  break;
                }
              }
              if (rawSent === 0 && rawSat > 5.0) {
                rawSent = Math.round(rawSat);
              }
              rawSat = realSat;
            }

            // NPS가 응답수(5, 6 등 소액 정수)와 완전히 같고 실제 NPS는 다른 열에 있는 경우 교정
            if (rawNps <= 10 && rawResp > 0 && Math.round(rawNps) === rawResp) {
              for (let c = 6; c <= 11; c++) {
                const v = parseFloat(row[c]);
                if (!isNaN(v) && (v > 10.0 || v === 0) && v !== rawSent && v !== rawResp) {
                  rawNps = v;
                  break;
                }
              }
            }

            // [자가치유 3] 교재완성도가 5.0 초과(예: 과정코드 306,796)인 경우 완벽 차단 및 인접 만족도 복원
            let rawTextbook = parseFloat(row[idxTextbook]) || 0;
            if (rawTextbook > 5.0 || rawTextbook < 0) {
              let realTextbook = 0;
              for (let c = 9; c <= 14; c++) {
                const v = parseFloat(row[c]);
                if (!isNaN(v) && v >= 1.0 && v <= 5.0 && c !== idxCourseSat) {
                  realTextbook = v;
                }
              }
              rawTextbook = realTextbook;
            }

            // 기타 강사 평가 점수들 5점 척도 범위 보정
            const sanitizeScore = (val) => {
              const num = parseFloat(val) || 0;
              return (num > 5.0 || num < 0) ? 0 : num;
            };

            const rawInstSat = sanitizeScore(row[idxInstSat]);
            const rawExpertise = sanitizeScore(row[idxExpertise]);
            const rawDelivery = sanitizeScore(row[idxDelivery]);
            const rawPractical = sanitizeScore(row[idxPractical]);

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
              sent_count: rawSent,
              respondent_count: rawResp,
              nps: rawNps,
              course_satisfaction: rawSat,
              instructor_satisfaction_avg: rawInstSat,
              teaching_expertise: rawExpertise,
              delivery_skill: rawDelivery,
              practical_use: rawPractical,
              textbook_quality: rawTextbook,
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

          // 정규화된 키 기반 중복 제거 및 Upsert
          const getNormKey = (r) => {
            const c = (r.course_name || '').trim().replace(/\s+/g, ' ');
            const d = (r.start_date || r.schedule_raw || '').trim();
            const i = (r.instructor_name || '').trim();
            return `${c}_${d}_${i}`;
          };

          let mergedExtra = [];
          if (replaceMode) {
            // 기본 내장 870건 데이터 중 새 파일에 없는 과정들을 deleted_courses에 넣어 숨김 처리
            const defaultCourses = (window.DEFAULT_SURVEY_RECORDS || []).map(r => r.course_name);
            const newCourseNames = new Set(newRecords.map(r => r.course_name));
            const coursesToHide = defaultCourses.filter(c => !newCourseNames.has(c));
            await this.saveToDB('deleted_courses', coursesToHide);

            const recordMap = new Map();
            newRecords.forEach(r => recordMap.set(getNormKey(r), r));
            mergedExtra = Array.from(recordMap.values());
          } else {
            const existingExtra = (await this.getFromDB('custom_records')) || [];
            const recordMap = new Map();
            existingExtra.forEach(r => recordMap.set(getNormKey(r), r));
            newRecords.forEach(r => recordMap.set(getNormKey(r), r));
            mergedExtra = Array.from(recordMap.values());
          }

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

  excelSerialToDateString(serial) {
    if (!serial) return '';
    const num = parseFloat(serial);
    if (!isNaN(num) && num >= 20000 && num <= 65000) {
      const utcDays = Math.floor(num - 25569);
      const utcValue = utcDays * 86400;
      const dateInfo = new Date(utcValue * 1000);
      const year = dateInfo.getUTCFullYear();
      const month = String(dateInfo.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dateInfo.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return '';
  }

  parseSchedule(s) {
    if (!s) return { start_date: '', end_date: '', month: 0, round_name: '', display_period: '' };
    const str = String(s).trim();

    // 1. 단독 시리얼 번호인 경우 (예: "46104" 또는 46104)
    const serialDate = this.excelSerialToDateString(str);
    if (serialDate) {
      const month = parseInt(serialDate.split('-')[1]);
      return { start_date: serialDate, end_date: serialDate, month, round_name: '', display_period: serialDate };
    }

    // 2. [시리얼 ~ 시리얼] N차 형태
    const mSerial = str.match(/\[\s*(\d{5}(?:\.\d+)?)\s*~\s*(\d{5}(?:\.\d+)?)\s*\]\s*(.*)/);
    if (mSerial) {
      const [_, s1, s2, round_name] = mSerial;
      const d1 = this.excelSerialToDateString(s1) || s1;
      const d2 = this.excelSerialToDateString(s2) || s2;
      const month = d1.includes('-') ? parseInt(d1.split('-')[1]) : 0;
      return { start_date: d1, end_date: d2, month, round_name: (round_name || '').trim(), display_period: `${d1} ~ ${d2}` };
    }

    // 3. [YYYY-MM-DD ~ YYYY-MM-DD] N차 또는 제N차 파싱
    const m = str.match(/\[\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*\]\s*(.*)/);
    if (m) {
      const [_, start_date, end_date, round_name] = m;
      const month = parseInt(start_date.split('-')[1]);
      return { start_date, end_date, month, round_name: round_name.trim(), display_period: `${start_date} ~ ${end_date}` };
    }

    // 4. 일자만 있는 경우
    const m2 = str.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
    if (m2) {
      const [_, start_date, end_date] = m2;
      const month = parseInt(start_date.split('-')[1]);
      return { start_date, end_date, month, round_name: '', display_period: `${start_date} ~ ${end_date}` };
    }

    // 5. YYYY-MM-DD 단독인 경우
    const m3 = str.match(/(\d{4}-\d{2}-\d{2})/);
    if (m3) {
      const start_date = m3[1];
      const month = parseInt(start_date.split('-')[1]);
      return { start_date, end_date: start_date, month, round_name: '', display_period: start_date };
    }

    return { start_date: '', end_date: '', month: 0, round_name: '', display_period: str };
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

  setCellValue(sheetXml, coord, value, isString = false, styleId = null) {
    const pattern = new RegExp(`(<c\\s+r="${coord}"[^>]*?)(?:/>|>(.*?)</c>)`, 's');
    const m = sheetXml.match(pattern);

    if (isString) {
      const valStr = this.escapeXml(value);
      const newContent = `<is><t>${valStr}</t></is>`;
      if (m) {
        let openTag = m[1].replace(/\s+t="[^"]*"/, '');
        if (styleId !== null) {
          if (/\ss="[^"]*"/.test(openTag)) {
            openTag = openTag.replace(/\ss="[^"]*"/, ` s="${styleId}"`);
          } else {
            openTag += ` s="${styleId}"`;
          }
        }
        openTag += ' t="inlineStr">';
        return sheetXml.slice(0, m.index) + openTag + newContent + '</c>' + sheetXml.slice(m.index + m[0].length);
      } else {
        const rowNum = coord.match(/\d+/)[0];
        const rowPattern = new RegExp(`(<row\\s+r="${rowNum}"[^>]*>)`, 's');
        const rm = sheetXml.match(rowPattern);
        if (rm) {
          const sAttr = styleId !== null ? ` s="${styleId}"` : '';
          const cellXml = `<c r="${coord}"${sAttr} t="inlineStr">${newContent}</c>`;
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
        if (styleId !== null) {
          if (/\ss="[^"]*"/.test(openTag)) {
            openTag = openTag.replace(/\ss="[^"]*"/, ` s="${styleId}"`);
          } else {
            openTag += ` s="${styleId}"`;
          }
        }
        openTag += '>';
        return sheetXml.slice(0, m.index) + openTag + newContent + '</c>' + sheetXml.slice(m.index + m[0].length);
      } else {
        const rowNum = coord.match(/\d+/)[0];
        const rowPattern = new RegExp(`(<row\\s+r="${rowNum}"[^>]*>)`, 's');
        const rm = sheetXml.match(rowPattern);
        if (rm) {
          const sAttr = styleId !== null ? ` s="${styleId}"` : '';
          const cellXml = `<c r="${coord}"${sAttr}>${newContent}</c>`;
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

          // 1회차(막대) 및 누적회차(꺾은선) 차트 원형 템플릿 추출
          const chartBarSat = await zip.file('xl/charts/chart1.xml').async('string');
          const chartBarNps = await zip.file('xl/charts/chart2.xml').async('string');
          const chartLineSat = await zip.file('xl/charts/chart7.xml').async('string');
          const chartLineNps = await zip.file('xl/charts/chart8.xml').async('string');
          const chartComplaints = await zip.file('xl/charts/chart3.xml').async('string');
          const chartPreferred = await zip.file('xl/charts/chart4.xml').async('string');
          const chartPositions = await zip.file('xl/charts/chart5.xml').async('string');
          const chartMotives = await zip.file('xl/charts/chart6.xml').async('string');

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
            const extraRows = (mode === 'course' && instructors.length > 1) ? (instructors.length - 1) * 2 : 0;
            let dXml = baseDrawingXml;

            if (extraRows > 0) {
              // 1. 12행 이상의 모든 row 및 cell 좌표 시프트 (+ extraRows)
              sXml = sXml.replace(/<c\s+r="([A-Z]+)(\d+)"/g, (match, col, rNum) => {
                const n = parseInt(rNum);
                return n >= 12 ? `<c r="${col}${n + extraRows}"` : match;
              });

              sXml = sXml.replace(/<row\s+r="(\d+)"/g, (match, rNum) => {
                const n = parseInt(rNum);
                return n >= 12 ? `<row r="${n + extraRows}"` : match;
              });

              sXml = sXml.replace(/<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (match, c1, r1, c2, r2) => {
                const n1 = parseInt(r1);
                const n2 = parseInt(r2);
                const newR1 = n1 >= 12 ? n1 + extraRows : n1;
                const newR2 = n2 >= 12 ? n2 + extraRows : n2;
                return `<mergeCell ref="${c1}${newR1}:${c2}${newR2}"/>`;
              });

              // 2. 추가 강사 행 (12, 13, 14, 15 ...) 생성
              const newRowsXml = [];
              const newMergeCells = [];
              for (let k = 1; k < instructors.length; k++) {
                const rTop = 10 + k * 2;
                const rBot = 11 + k * 2;
                const instK = instructors[k];
                const curK = instK.current || {};
                const cumK = instK.cumulative || {};
                const nameStr = this.escapeXml(instK.instructor_name || '');
                const currStr = this.escapeXml(instK.curriculum || '');
                const hoursVal = this.escapeXml(instK.hours || '');

                const rTopXml = `<row r="${rTop}" spans="2:9" ht="67.5" customHeight="1" x14ac:dyDescent="0.3">` +
                  `<c r="B${rTop}" s="10" t="inlineStr"><is><t>${nameStr}</t></is></c>` +
                  `<c r="C${rTop}" s="40" t="inlineStr"><is><t>${currStr}</t></is></c>` +
                  `<c r="D${rTop}" s="41"/>` +
                  `<c r="E${rTop}" s="11" t="inlineStr"><is><t>이번&#10;차수</t></is></c>` +
                  `<c r="F${rTop}" s="12"><v>${Number(curK.teaching_expertise || 0).toFixed(1)}</v></c>` +
                  `<c r="G${rTop}" s="12"><v>${Number(curK.delivery_skill || 0).toFixed(1)}</v></c>` +
                  `<c r="H${rTop}" s="12"><v>${Number(curK.practical_use || 0).toFixed(1)}</v></c>` +
                  `<c r="I${rTop}" s="13"><v>${Number(curK.textbook_quality || 0).toFixed(1)}</v></c>` +
                  `</row>`;

                const rBotXml = `<row r="${rBot}" spans="2:9" ht="67.5" customHeight="1" x14ac:dyDescent="0.3">` +
                  `<c r="B${rBot}" s="14" t="inlineStr"><is><t>${hoursVal}</t></is></c>` +
                  `<c r="C${rBot}" s="42"/>` +
                  `<c r="D${rBot}" s="43"/>` +
                  `<c r="E${rBot}" s="11" t="inlineStr"><is><t>누적&#10;평균</t></is></c>` +
                  `<c r="F${rBot}" s="12"><v>${Number(cumK.teaching_expertise || 0).toFixed(1)}</v></c>` +
                  `<c r="G${rBot}" s="12"><v>${Number(cumK.delivery_skill || 0).toFixed(1)}</v></c>` +
                  `<c r="H${rBot}" s="12"><v>${Number(cumK.practical_use || 0).toFixed(1)}</v></c>` +
                  `<c r="I${rBot}" s="13"><v>${Number(cumK.textbook_quality || 0).toFixed(1)}</v></c>` +
                  `</row>`;

                newRowsXml.push(rTopXml + rBotXml);
                newMergeCells.push(`<mergeCell ref="C${rTop}:D${rBot}"/>`);
              }

              // 11행 끝난 직후 삽입
              sXml = sXml.replace(/(<row\s+r="11"[^>]*>.*?<\/row>)/s, `$1${newRowsXml.join('')}`);

              // mergeCells 추가
              if (newMergeCells.length > 0) {
                sXml = sXml.replace(/<mergeCells\s+count="(\d+)">/, (match, count) => {
                  const cnt = parseInt(count) + newMergeCells.length;
                  return `<mergeCells count="${cnt}">${newMergeCells.join('')}`;
                });
              }

              // drawing1.xml 차트 앵커 시프트
              dXml = dXml.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (match, rNum) => {
                const n = parseInt(rNum);
                return n >= 11 ? `<xdr:row>${n + extraRows}</xdr:row>` : match;
              });
            }

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
              const instS = comments.instructor_sentiment || [];
              const contS = comments.content_sentiment || [];
              const recS = comments.recommend_sentiment || [];

              const getStyleId = (sent) => {
                if (sent === '중립' || sent === '보완') return 39;
                if (sent === '부정') return 40;
                return 20; // 긍정
              };

              for (let i = 0; i < 4; i++) {
                const iText = instF[i] || '';
                const iSent = instS[i] || '긍정';
                sXml = this.setCellValue(sXml, `E${61 + i}`, iText, true);
                if (iText) {
                  sXml = this.setCellValue(sXml, `D${61 + i}`, iSent, true, getStyleId(iSent));
                } else {
                  sXml = this.setCellValue(sXml, `D${61 + i}`, '', true, 20);
                }

                const cText = contF[i] || '';
                const cSent = contS[i] || '긍정';
                sXml = this.setCellValue(sXml, `E${65 + i}`, cText, true);
                if (cText) {
                  sXml = this.setCellValue(sXml, `D${65 + i}`, cSent, true, getStyleId(cSent));
                } else {
                  sXml = this.setCellValue(sXml, `D${65 + i}`, '', true, 20);
                }

                const rText = recF[i] || '';
                const rSent = recS[i] || '긍정';
                sXml = this.setCellValue(sXml, `E${69 + i}`, rText, true);
                if (rText) {
                  sXml = this.setCellValue(sXml, `D${69 + i}`, rSent, true, getStyleId(rSent));
                } else {
                  sXml = this.setCellValue(sXml, `D${69 + i}`, '', true, 20);
                }
              }
            } else {
              const instF = comments.instructor_feedback || [];
              const contF = comments.content_feedback || [];
              const operF = comments.operation_feedback || [];
              const recF = comments.recommend_feedback || [];
              const addF = comments.additional_courses || [];
              sXml = this.setCellValue(sXml, `E${61 + extraRows}`, instF[0] || '', true);
              sXml = this.setCellValue(sXml, `E${62 + extraRows}`, instF[1] || '', true);
              sXml = this.setCellValue(sXml, `E${63 + extraRows}`, contF[0] || '', true);
              sXml = this.setCellValue(sXml, `E${64 + extraRows}`, operF[0] || '', true);
              sXml = this.setCellValue(sXml, `E${65 + extraRows}`, recF[0] || '', true);
              sXml = this.setCellValue(sXml, `E${66 + extraRows}`, recF[1] || '', true);
              sXml = this.setCellValue(sXml, `E${67 + extraRows}`, recF[2] || '', true);
              sXml = this.setCellValue(sXml, `E${68 + extraRows}`, addF[0] || '', true);
            }

            zip.file(`xl/worksheets/sheet${sheetNum}.xml`, sXml);

            // 2. Sheet Rels
            const sRels = baseSheetRels.replace('drawing1.xml', `drawing${drawingNum}.xml`);
            zip.file(`xl/worksheets/_rels/sheet${sheetNum}.xml.rels`, sRels);

            // 3. Drawing XML
            zip.file(`xl/drawings/drawing${drawingNum}.xml`, dXml);

            // 4. Drawing Rels
            let dRels = baseDrawingRels;
            for (let c = 0; c < 6; c++) {
              dRels = dRels.replace(`../charts/chart${c + 1}.xml`, `../charts/chart${startChartNum + c}.xml`);
            }
            zip.file(`xl/drawings/_rels/drawing${drawingNum}.xml.rels`, dRels);

            // 5. 6개 차트 주입 (1회차는 막대, 2회차 이상 누적 시 꺾은선으로 자동 전환)
            const chartsData = sdata.charts || {};
            const c0Data = chartsData.chart0_satisfaction_trend || {};
            const c1Data = chartsData.chart1_nps_trend || {};

            const cats0 = c0Data.categories || [];
            const cats1 = c1Data.categories || [];

            // 교육과정내용 만족도 및 추천지수: 누적(2개 이상)이면 lineChart(꺾은선), 1개이면 barChart(막대)
            const c0Template = cats0.length > 1 ? chartLineSat : chartBarSat;
            const c1Template = cats1.length > 1 ? chartLineNps : chartBarNps;

            const chartDefs = [
              [c0Template, c0Data, true, true],
              [c1Template, c1Data, true, true],
              [chartComplaints, chartsData.chart2_complaints || {}, false, false],
              [chartPreferred, chartsData.chart3_preferred_format || {}, false, false],
              [chartPositions, chartsData.chart4_positions || {}, false, false],
              [chartMotives, chartsData.chart5_motives || {}, false, false],
            ];

            chartDefs.forEach(([tXml, cData, isRef, isFloat], cIdx) => {
              let cXml = tXml;
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
      const instS = comments.instructor_sentiment || [];
      const contS = comments.content_sentiment || [];
      const recS = comments.recommend_sentiment || [];

      // 3개 섹션 + 감성 배지 (긍정/중립/부정)
      const addSection = (rStart, title, items, sents) => {
        ws.mergeCells(`B${rStart}:C${rStart + 3}`);
        const tCell = ws.getCell(`B${rStart}`);
        tCell.value = title;
        tCell.font = { name: '맑은 고딕', size: 10, bold: true };
        tCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        tCell.border = thinBorder;

        for (let i = 0; i < 4; i++) {
          const row = rStart + i;
          const textVal = items[i] || '';
          const sentVal = sents[i] || '긍정';
          const posCell = ws.getCell(`D${row}`);

          if (textVal) {
            posCell.value = sentVal;
            if (sentVal === '중립' || sentVal === '보완') {
              posCell.font = { name: '맑은 고딕', size: 11, bold: false, color: { argb: 'FF9C5700' } };
              posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
            } else if (sentVal === '부정') {
              posCell.font = { name: '맑은 고딕', size: 11, bold: false, color: { argb: 'FF9C0006' } };
              posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
            } else {
              posCell.font = { name: '맑은 고딕', size: 11, bold: false, color: { argb: 'FF006100' } };
              posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
            }
          } else {
            posCell.value = '';
          }
          posCell.alignment = { vertical: 'middle', horizontal: 'center' };
          posCell.border = thinBorder;

          ws.mergeCells(`E${row}:I${row}`);
          const valCell = ws.getCell(`E${row}`);
          valCell.value = textVal;
          valCell.font = { name: '맑은 고딕', size: 10 };
          valCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
          valCell.border = thinBorder;
        }
      };

      addSection(61, '  강사님 관련 의견', instF, instS);
      addSection(65, '  교육 내용 관련 의견', contF, contS);
      addSection(69, '  본 교육과정 추천 시 추천 사유', recF, recS);
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
