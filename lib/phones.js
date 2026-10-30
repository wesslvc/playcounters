import { db } from '@/lib/db';

/**
 * newphoneprediction: collects what leakers and reviewers are saying about
 * current and upcoming phones, then has the model fold it into one structured
 * report the page can rank and compare locally.
 *
 * Two stages. Several web-searching calls each read one slice of the web
 * (Ice Universe on X, the 알뷰 YouTube channel, spec sheets of released and of
 * upcoming phones) and write plain notes with their sources. A final call
 * with no tools turns the notes into the schema. Nothing in the final call
 * may be invented: whatever the notes don't support is left null or marked
 * as a rumor, so the page can show how sure each claim is.
 */

const MODEL = () => process.env.OPENAI_MODEL_PHONES || process.env.OPENAI_MODEL || 'gpt-6.1-terra';
export const REPORT_ID = 'latest';

async function responses(body, signal) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.output_text
    ?? (json.output ?? []).flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text
    ?? '';
}

const search = (instructions, input, signal) =>
  responses({
    model: MODEL(),
    reasoning: { effort: 'low' },
    tools: [{ type: 'web_search' }],
    instructions,
    input,
  }, signal);

const NOTES = '조사 노트를 한국어로 쓴다. 찾은 내용마다 출처(사이트/계정 이름과 URL, 가능하면 날짜)를 붙이고, '
  + '확정(공식 발표)·유력(신뢰할 만한 유출)·루머(단일/불확실 출처)를 구분해 표시한다. '
  + '찾지 못한 것은 찾지 못했다고 쓰고 절대 지어내지 마라. 모델명·무게(g)·칩셋·배터리(mAh)·충전(W)·디스플레이·카메라·'
  + '소프트웨어 업데이트 연한·가격(원화 또는 현지 가격)·출시(예정)일을 가능한 한 수치로 적는다.';

function researchJobs(today) {
  return [
    {
      name: 'ice-universe',
      instructions: `${NOTES} 오늘은 ${today}.`,
      input: 'X(트위터)의 Ice Universe(@UniverseIce)가 최근 몇 달간 올린 스마트폰 유출·평가 글을 가능한 한 전부 찾아 정리해라. '
        + '그 글을 인용·보도한 기사(GSMArena, Android Authority, SamMobile, 전자신문 등)도 함께 찾아 교차 확인하고, '
        + '삼성·애플·구글·샤오미·원플러스·오포·비보·혼오 등 어느 폰에 대한 정보인지 폰별로 묶어라. 무게, 칩셋, 배터리, 카메라, 디스플레이 관련 언급은 특히 빠짐없이.',
    },
    {
      name: 'albyu',
      instructions: `${NOTES} 오늘은 ${today}.`,
      input: '유튜브 채널 "알뷰"(한국 IT·스마트폰 유튜버)가 최근 몇 달간 올린 최신 스마트폰 유출·루머·리뷰 영상을 가능한 한 전부 찾아 '
        + '영상 제목·날짜·URL과 함께 폰별로 핵심 내용(무게, 업데이트 정책, 칩셋 성능, 배터리, 카메라, 가격 등)을 정리해라. '
        + '영상 내용을 직접 볼 수 없다면 제목·설명·그 영상을 다룬 기사에서 확인되는 것만 쓰고, 그렇다고 밝혀라.',
    },
    {
      name: 'released',
      instructions: `${NOTES} 오늘은 ${today}.`,
      input: '최근 12개월 안에 출시된 주요 스마트폰(갤럭시 S/Z/A 상위, 아이폰, 픽셀, 샤오미, 원플러스, 오포 등 한국에서 관심 많은 모델 위주 12~16개)의 '
        + '공식 스펙과 실측 무게, 칩셋(AnTuTu/Geekbench 같은 벤치마크 수치 포함), 배터리·충전, 디스플레이, 카메라, OS 업데이트 보장 연수, 한국 출시가를 정리해라. '
        + '장단점에 대한 리뷰어들의 공통된 평가도 한 줄씩.',
    },
    {
      name: 'upcoming',
      instructions: `${NOTES} 오늘은 ${today}.`,
      input: '앞으로 6~9개월 안에 출시될 것으로 알려진 주요 스마트폰(차기 갤럭시 S·폴더블, 차기 아이폰, 픽셀, 샤오미, 원플러스 등)의 유출 정보를 정리해라. '
        + '예상 출시 시기, 칩셋(예: 스냅드래곤·엑시노스·A시리즈·텐서 세대와 예상 성능 향상), 예상 무게·두께, 배터리, 카메라 변화, 가격 전망, 소프트웨어 업데이트 정책 변화를 '
        + '출처와 신뢰도(확정/유력/루머)와 함께 적어라.',
    },
  ];
}

const SCORE = { type: 'integer' };
const nullable = (type) => ({ type: [type, 'null'] });
const STR = { type: 'string' };

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'phones', 'sources'],
  properties: {
    summary: STR,
    sources: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['label', 'url'],
        properties: { label: STR, url: nullable('string') },
      },
    },
    phones: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: [
          'id', 'brand', 'name', 'os', 'form', 'status', 'release', 'chipset', 'weight_g', 'battery_mah', 'charge_w',
          'display', 'camera', 'update_years', 'price_krw', 'scores', 'highlights', 'cautions', 'leaks', 'summary', 'confidence',
        ],
        properties: {
          id: STR, brand: STR, name: STR,
          os: { enum: ['android', 'ios'] },
          form: { enum: ['bar', 'foldable', 'flip'] },
          status: { enum: ['released', 'upcoming', 'rumored'] },
          release: STR,
          chipset: STR,
          weight_g: nullable('number'),
          battery_mah: nullable('number'),
          charge_w: nullable('number'),
          display: STR,
          camera: STR,
          update_years: nullable('number'),
          price_krw: nullable('number'),
          scores: {
            type: 'object', additionalProperties: false,
            required: ['performance', 'camera', 'battery', 'display', 'design'],
            properties: { performance: SCORE, camera: SCORE, battery: SCORE, display: SCORE, design: SCORE },
          },
          highlights: { type: 'array', items: STR },
          cautions: { type: 'array', items: STR },
          leaks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['claim', 'source', 'certainty'],
              properties: { claim: STR, source: STR, certainty: { enum: ['확정', '유력', '루머'] } },
            },
          },
          summary: STR,
          confidence: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const SYNTH = '너는 스마트폰 비교 데이터 편집자다. 아래 조사 노트만 근거로, 지금 살 수 있는 폰과 곧 나올 폰을 합쳐 14~20개의 폰 목록을 만든다. '
  + '규칙: (1) 노트에 없는 수치는 null로 두거나 문장에서 빼라 — 추측으로 채우지 마라. '
  + '(2) 출시 전 폰은 status를 upcoming(유력 정보 다수) 또는 rumored(루머뿐)로, 그 수치는 leaks에 certainty와 출처를 붙여 적어라. '
  + '(3) scores는 0~100 정수로, 같은 목록 안에서 상대 평가: performance는 칩셋 벤치마크, camera는 센서·렌즈 구성과 리뷰 평가, '
  + 'battery는 용량·효율·충전 속도, display는 밝기·주사율·패널, design은 마감·두께·완성도. 출시 전 폰은 노트의 유출/세대 향상분으로 추정하되 confidence를 낮춰라. '
  + '(4) 무게 업데이트 칩셋 같은 Ice Universe·알뷰의 언급은 해당 폰의 leaks와 highlights/cautions에 반영하라. '
  + '(5) id는 영문 소문자 slug. highlights·cautions는 짧은 한국어 구절 2~4개씩. summary는 한국어 한두 문장. '
  + '(6) 최상위 summary에는 지금 시장 분위기와 이번 조사의 한계(찾지 못한 출처 등)를 솔직히 2~3문장으로 쓴다. '
  + '(7) sources에는 노트에 실제로 나온 출처만 넣는다.';

/** Reads the web, writes the report. Takes minutes — meant for the cron/refresh route, not a page view. */
export async function buildReport() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 270e3);
  try {
    const jobs = researchJobs(today);
    const settled = await Promise.allSettled(jobs.map((j) => search(j.instructions, j.input, ctl.signal)));
    const notes = settled.map((s, i) => (s.status === 'fulfilled'
      ? `### ${jobs[i].name}\n${s.value}`
      : `### ${jobs[i].name}\n(수집 실패: ${s.reason?.message ?? s.reason})`));
    if (settled.every((s) => s.status === 'rejected')) throw new Error(`all research calls failed: ${settled[0].reason?.message}`);

    const raw = await responses({
      model: MODEL(),
      reasoning: { effort: 'medium' },
      instructions: `${SYNTH} 오늘은 ${today}.`,
      input: notes.join('\n\n'),
      text: { format: { type: 'json_schema', name: 'phones', strict: true, schema: REPORT_SCHEMA } },
    }, ctl.signal);
    const report = JSON.parse(raw);
    report.phones = report.phones.filter((p) => p.id && p.name);
    if (!report.phones.length) throw new Error('empty phone list');
    return { ...report, generated_at: new Date().toISOString(), failed: settled.filter((s) => s.status === 'rejected').length };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveReport(report) {
  const { error } = await db.from('phone_reports')
    .upsert({ id: REPORT_ID, data: report, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function loadReport() {
  const { data, error } = await db.from('phone_reports').select('data, updated_at').eq('id', REPORT_ID).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.data ?? null;
}
